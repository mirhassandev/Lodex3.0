'use strict';

const EventEmitter = require('events');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { StreamTask } = require('./stream-downloader.cjs');
const { classify } = require('./url-classifier.cjs');
const { SegmentedDownloader } = require('./segmented-downloader.cjs');
const { QueueManager } = require('./queue-manager.cjs');
const { requestWithRedirect, headWithRedirect } = require('./request-utils.cjs');

class DownloadTask extends EventEmitter {
  constructor(id, url, outPath, options = {}) {
    super();
    this.id = id;
    this.url = url;
    this.outPath = outPath;
    this.options = options;
    this.status = 'queued';
    this.aborted = false;
    this.completed = false; // Explicit completion status
    this.error = null;
    this.connections = options.connections || 8;
    this.timeout = options.timeout || 15000;
    this.requests = [];
    this.size = 0;
    this.downloaded = 0;
    this.ranges = [];
    this.fileHandle = null;
    this.manifestPath = `${outPath}.download.meta`;
    this.ytdlStream = null;
    this.resolution = options.resolution;
    this.title = options.title;
    this.customHeaders = options.headers || {};

    this.speedInterval = null;
    this.speedLimit = 0; // 0 = unlimited
  }

  throttle(limit) {
    this.speedLimit = limit;
    console.log(`[DownloadTask] Throttling for ${this.id}: ${limit} B/s`);
  }

  async headRequest() {
    try {
      return await headWithRedirect(this.url, this.customHeaders, this.timeout);
    } catch (err) {
      console.warn(`[DownloadTask] Head request failed for ${this.id}, falling back to GET:`, err.message);
      return { length: 0, acceptRanges: false, headers: {} };
    }
  }

  splitRanges(total, parts) {
    const ranges = [];
    const partSize = Math.floor(total / parts);
    let start = 0;
    for (let i = 0; i < parts; i++) {
      const end = i === parts - 1 ? total - 1 : start + partSize - 1;
      ranges.push({ start, end, downloaded: 0, done: false });
      start = end + 1;
    }
    return ranges;
  }

  async start() {
    if (this.status === 'downloading') return;

    this.status = 'downloading';
    console.log(`[DownloadTask] Starting task: ${this.id} (${this.url.substring(0, 50)}...)`);

    // Emit early started so UI shows connecting/downloading status
    this.emit('started', { id: this.id, size: this.size || 0 });

    try {
      // Check for YouTube
      if (this.url.includes('youtube.com') || this.url.includes('youtu.be') || this.protocol === 'ytdlp') {
        console.log(`[DownloadTask] Routed to YouTube/yt-dlp handler: ${this.id}`);
        this._startSpeedTicker();
        return await this._startYouTubeDownload();
      }

      console.log(`[DownloadTask] Probing server: ${this.id}`);

      const startTimeout = setTimeout(() => {
        if (this.status === 'downloading' && this.downloaded === 0) {
          console.error(`[DownloadTask] Start timeout for ${this.id}`);
          this.emit('error', new Error('Connection timed out during start'));
          this.cancel();
        }
      }, 30000);

      const head = await this.headRequest();
      
      if (head.finalUrl && head.finalUrl !== this.url) {
        console.log(`[DownloadTask] Redirect detected: ${this.url} -> ${head.finalUrl}`);
        this.url = head.finalUrl;
      }

      this.once('progress', () => clearTimeout(startTimeout));
      this.once('finished', () => clearTimeout(startTimeout));
      this.once('error', () => clearTimeout(startTimeout));

      // If we got content-length and server supports ranges, use segmented download
      if (head.size > 0 && head.acceptRanges) {
        console.log(`[DownloadTask] Range support detected. Size: ${head.size}`);
        this.size = head.size;

        // Dynamic segmentation strategy based on file size
        if (this.size > 1024 * 1024 * 1024) this.connections = 16;
        else if (this.size > 100 * 1024 * 1024) this.connections = 8;
        else if (this.size > 10 * 1024 * 1024) this.connections = 4;
        else this.connections = 2;

        this.ranges = this.splitRanges(this.size, this.connections);

        // create or truncate output file to the full size
        await fs.promises.writeFile(this.outPath, Buffer.alloc(1), { flag: 'w' });
        const fd = await fs.promises.open(this.outPath, 'r+');
        this.fileHandle = fd;

        this.emit('started', { id: this.id, size: this.size }); // Update with real size
        this._startSpeedTicker();
        this._runRanges();
      } else {
        // Fallback to simple streaming download (for video hosts, etc.)
        console.log(`[DownloadTask] No range support. Falling back to stream: ${this.id}`);
        this._startSpeedTicker();
        return await this._streamDownload();
      }
    } catch (err) {
      console.error(`[DownloadTask] Start failed critically for ${this.id}:`, err.message);
      this.emit('error', err);
    }
  }

  _startSpeedTicker() {
    if (this.speedInterval) clearInterval(this.speedInterval);
    this.lastDownloaded = this.downloaded || 0;
    this.speedHistory = [];

    this.speedInterval = setInterval(() => {
      if (this.aborted || this.completed) {
        clearInterval(this.speedInterval);
        return;
      }

      const downloadedNow = this.downloaded || 0;
      const bytesPerSec = downloadedNow - this.lastDownloaded;
      this.lastDownloaded = downloadedNow;

      this.speedHistory.push(bytesPerSec);
      if (this.speedHistory.length > 5) this.speedHistory.shift();

      const avgSpeed = this.speedHistory.length > 0 ? this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length : 0;
      const remainingBytes = this.size > 0 ? this.size - downloadedNow : 0;
      const eta = avgSpeed > 0 ? Math.round(remainingBytes / avgSpeed) : 0;

      // Ensure we only emit progress if size is known or we're streaming
      this.emit('progress', {
        id: this.id,
        downloaded: downloadedNow,
        total: this.size,
        speed: avgSpeed,
        eta: eta
      });
    }, 1000);
  }

  async _startYouTubeDownload() {
    try {
      this.emit('started', { id: this.id, size: 0 });

      const { spawn } = require('child_process');
      const path = require('path');
      const ytpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');
      const os = require('os');
      const fs = require('fs');

      // Workaround: Copy ffmpeg to temp dir to avoid spaces in path which yt-dlp hates
      const sourceFfmpeg = require('ffmpeg-static');
      const tempFfmpeg = path.join(os.tmpdir(), 'ffmpeg.exe');

      if (!fs.existsSync(tempFfmpeg)) {
        console.log('[Downloader] Copying ffmpeg to temp:', tempFfmpeg);
        fs.copyFileSync(sourceFfmpeg, tempFfmpeg);
      }
      const ffmpegPath = tempFfmpeg;
      console.log('[Downloader] Using temp ffmpegPath:', ffmpegPath);

      // 1. Resolve format strategy
      let formatStr = 'best';
      const extractionArgs = [];

      if (this.options.isAudioOnly || this.options.quality === 'audio') {
        const isMP3 = this.options.isAudioOnly && this.options.filename.toLowerCase().endsWith('.mp3');
        formatStr = 'bestaudio/best';

        if (isMP3) {
          extractionArgs.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
        }
      } else {
        const height = this.resolution ? parseInt(this.resolution, 10) : 1080;
        formatStr = `bestvideo[height<=?${height}]+bestaudio/best[height<=?${height}]`;
      }

      // Respect custom headers (Cookies, Referer, etc.)
      const headerArgs = [];
      Object.entries(this.customHeaders).forEach(([key, value]) => {
        if (value) {
          headerArgs.push('--add-header', `${key}:${value}`);
        }
      });

      const args = [
        this.url,
        '--format', formatStr,
        '--ffmpeg-location', ffmpegPath,
        ...extractionArgs,
        '--merge-output-format', extractionArgs.length > 0 ? '' : 'mp4',
        '--output', this.outPath,
        '--force-overwrites',
        '--no-playlist',
        '--newline',
        '--continue', // Add --continue for resuming
        '--progress', // Enable progress output
        '--progress-template', 'download:[%(progress.downloaded_bytes)s/%(progress.total_bytes)s] speed:[%(progress.speed)s] eta:[%(progress.eta)s]', // Custom progress template
        ...headerArgs
      ];

      // Add default headers if not provided
      if (!this.customHeaders['Referer'] && !this.customHeaders['referer']) {
        args.push('--add-header', 'referer:youtube.com');
      }

      console.log('[Downloader] Spawning yt-dlp with args:', args.join(' '));
      const subprocess = spawn(ytpPath, args);
      this.ytdlStream = subprocess;

      subprocess.on('spawn', () => {
        console.log(`[DownloadTask] YouTube downloader started (PID: ${subprocess.pid})`);
      });

      subprocess.stdout.on('data', (data) => {
        const line = data.toString();
        // Parse progress from yt-dlp output 
        if (line.includes('[download]')) {
          const percentMatch = line.match(/(\d+(\.\d+)?)%/);
          const sizeMatch = line.match(/of\s+~?(\d+(\.\d+)?)([KMG]i?B)/);

          if (percentMatch) {
            const percent = parseFloat(percentMatch[1]);
            if (sizeMatch && !this.size) {
              const val = parseFloat(sizeMatch[1]);
              const unit = sizeMatch[3];
              let bytes = val;
              if (unit.includes('K')) bytes *= 1024;
              if (unit.includes('M')) bytes *= 1024 * 1024;
              if (unit.includes('G')) bytes *= 1024 * 1024 * 1024;
              this.size = Math.floor(bytes);
            }

            if (this.size) {
              this.downloaded = Math.floor((percent / 100) * this.size);
              this.emit('progress', { id: this.id, downloaded: this.downloaded, total: this.size, outPath: this.outPath });
            }
          } else if (line.startsWith('download:')) { // Parse custom progress template
            const downloadedMatch = line.match(/download:\[(\d+(\.\d+)?)([KMG]i?B)\/(\d+(\.\d+)?)([KMG]i?B)\]/);
            const speedMatch = line.match(/speed:\[(\d+(\.\d+)?)([KMG]i?B\/s)\]/);
            const etaMatch = line.match(/eta:\[(\d+:\d+:\d+)\]/);

            if (downloadedMatch) {
              const parseBytes = (val, unit) => {
                let bytes = parseFloat(val);
                if (unit.includes('K')) bytes *= 1024;
                if (unit.includes('M')) bytes *= 1024 * 1024;
                if (unit.includes('G')) bytes *= 1024 * 1024 * 1024;
                return Math.floor(bytes);
              };

              const downloadedBytes = parseBytes(downloadedMatch[1], downloadedMatch[3]);
              const totalBytes = parseBytes(downloadedMatch[4], downloadedMatch[6]);
              const speedStr = speedMatch ? speedMatch[1] + speedMatch[3] : '0B/s';
              const etaStr = etaMatch ? etaMatch[1] : '00:00:00';

              this.downloaded = downloadedBytes;
              this.size = totalBytes;

              this.emit('progress', {
                id: this.id,
                downloaded: downloadedBytes,
                total: totalBytes,
                speed: speedStr,
                eta: etaStr,
                outPath: this.outPath
              });
            }
          }
        }
      });

      subprocess.stderr.on('data', (data) => {
        this.lastStderr = data.toString();
        console.error('yt-dlp stderr:', this.lastStderr);
      });

      subprocess.on('close', (code) => {
        if (code === 0) {
          this.completed = true;
          this.emit('finished', { id: this.id, path: this.outPath });
        } else if (!this.aborted) {
          const errorMsg = `yt-dlp failed (code ${code}). ${this.lastStderr || ''}`;
          console.error('[Downloader] YouTube Error:', errorMsg);
          this.emit('error', new Error(errorMsg));
        }
      });

      subprocess.on('error', (err) => {
        if (!this.aborted) this.emit('error', err);
      });

    } catch (err) {
      if (this.aborted) return;
      this.emit('error', err);
    }
  }

  async _streamDownload() {
    try {
      const res = await requestWithRedirect(this.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/octet-stream, */*',
          ...this.customHeaders
        },
        timeout: this.timeout
      });

      if (res.statusCode >= 400) {
        res.resume();
        throw new Error(`HTTP ${res.statusCode}`);
      }

      // Update URL to final direct target if it redirected
      if (res.finalUrl && res.finalUrl !== this.url) {
        this.url = res.finalUrl;
      }

      const contentType = (res.headers['content-type'] || '').toLowerCase();
      const urlPath = new URL(this.url).pathname.toLowerCase();
      const isLikelyBinary = /\.(exe|dmg|iso|zip|tar|gz|msi|apk|pkg|deb|rpm|7z|rar|bin|img)/.test(urlPath);

      // Detect mirror-selector pages (like get.videolan.org) that return HTML instead of the file
      if (contentType.includes('text/html') && isLikelyBinary) {
        // Buffer up to 8KB to look for meta-refresh or direct download link
        console.log(`[DownloadTask] HTML detected for binary URL on ${this.id}. Scanning for redirect...`);
        const chunks = [];
        let totalRead = 0;
        await new Promise((resolve) => {
          res.on('data', (chunk) => {
            if (totalRead < 8192) {
              chunks.push(chunk);
              totalRead += chunk.length;
            } else {
              res.destroy();
              resolve();
            }
          });
          res.on('end', resolve);
          res.on('error', resolve);
        });
        const html = Buffer.concat(chunks).toString('utf8');
        // Look for meta-refresh redirect: <meta http-equiv="refresh" content="0; url=...">
        const metaMatch = html.match(/content=["'][\d.]+;\s*url=([^"']+)["']/i);
        if (metaMatch) {
          let redirectUrl = metaMatch[1].trim();
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = new URL(redirectUrl, this.url).href;
          }
          console.log(`[DownloadTask] Meta-refresh redirect found: ${redirectUrl}`);
          this.url = redirectUrl;
          return this._streamDownload(); // retry with new URL
        }
        // No redirect found — surface error to user
        throw new Error('URL leads to a web page, not a direct download. Please copy the direct download link.');
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > 0) {
        this.size = contentLength;
        this.emit('started', { id: this.id, size: contentLength });
      } else {
        this.emit('started', { id: this.id, size: 0 });
      }

      const writeStream = fs.createWriteStream(this.outPath);

      res.on('data', (chunk) => {
        if (this.aborted || this.completed) {
          res.destroy();
          writeStream.destroy();
          return;
        }
        this.downloaded += chunk.length;
        // Speed and progress is reported by _startSpeedTicker every 1s
        if (!this.size && contentLength === 0) {
          // Unknow size: update best-effort from running bytes
          this.size = this.downloaded; // will be corrected on next tick
        }
      });

      res.pipe(writeStream);

      writeStream.on('finish', () => {
        if (!this.aborted) {
          this.completed = true;
          if (this.speedInterval) clearInterval(this.speedInterval);
          this.emit('finished', { id: this.id, path: this.outPath, size: this.downloaded });
        }
      });

      writeStream.on('error', (err) => {
        this.emit('error', err);
      });

      res.on('error', (err) => {
        if (!this.aborted) this.emit('error', err);
      });
    } catch (err) {
      this.emit('error', err);
    }
  }

  async _runRanges() {
    // Use directUrl if set (for YouTube), otherwise this.url
    const useUrl = this.directUrl || this.url;
    const urlObj = new URL(useUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const active = [];

    const nextRange = () => this.ranges.find(r => !r.done && !r.inFlight);

    const startRequestFor = async (range) => {
      if (this.aborted || this.completed) return;
      range.inFlight = true;

      try {
        const res = await requestWithRedirect(this.url, {
          method: 'GET',
          headers: {
            'Range': `bytes=${range.start + range.downloaded}-${range.end}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...this.customHeaders
          },
          timeout: 120000 // 2 minutes idle timeout instead of 15 seconds
        });

        if (res.statusCode >= 400) {
          throw new Error(`HTTP ${res.statusCode}`);
        }

        try {
          for await (const chunk of res) {
            if (this.aborted || this.completed) {
              res.destroy();
              return;
            }
            
            const writeOffset = range.start + range.downloaded;
            await this.fileHandle.write(chunk, 0, chunk.length, writeOffset);
            
            range.downloaded += chunk.length;
            this.downloaded += chunk.length;
            // Don't emit per-chunk progress — _startSpeedTicker handles this every 1s with speed included

            // Throttling Logic for segmented ranges
            if (this.speedLimit > 0) {
              const sharedLimit = this.speedLimit / this.connections;
              const delay = (chunk.length / sharedLimit) * 1000;
              if (delay > 2) {
                await new Promise(r => setTimeout(r, Math.min(delay, 2000)));
              }
            }
          }
          
          range.done = range.downloaded >= (range.end - range.start + 1);
          range.inFlight = false;
          // start another range if available
          const nr = nextRange();
          if (nr) startRequestFor(nr);
          this._checkComplete();
          
        } catch (err) {
          res.destroy();
          throw err;
        }

      } catch (err) {
        range.inFlight = false;
        this.emit('error', err);
      }
    };

    // kick off up to connections requests
    for (let i = 0; i < this.connections; i++) {
      const r = nextRange();
      if (!r) break;
      startRequestFor(r);
    }
  }

  _checkComplete() {
    if (this.ranges.every(r => r.done)) {
      this.completed = true;
      if (this.speedInterval) clearInterval(this.speedInterval);
      this.emit('finished', { id: this.id, path: this.outPath, size: this.size });
      if (this.fileHandle) this.fileHandle.close().catch(() => { });
      fs.unlink(this.manifestPath, () => { });
    }
  }

  pause() {
    this.aborted = true;
    for (const req of this.requests) {
      try { req.destroy(); } catch (e) { }
    }
    this.requests = [];

    if (this.ytdlStream) {
      try {
        if (typeof this.ytdlStream.kill === 'function') {
          this.ytdlStream.kill('SIGKILL');
        } else {
          this.ytdlStream.destroy();
        }
      } catch (e) { }
      this.ytdlStream = null;
    }

    if (this.fileHandle) {
      this.fileHandle.close().catch(() => { });
    }

    // Save state including directUrl if needing resume (simple resume might fail if link expired)
    // But for now, save ranges.
    if (this.ranges && this.ranges.length > 0) {
      fs.writeFileSync(this.manifestPath, JSON.stringify({
        url: this.url,
        directUrl: this.directUrl, // Save direct URL
        outPath: this.outPath,
        size: this.size,
        ranges: this.ranges
      }));
    }
    this.emit('paused', { id: this.id });
  }

  resume() {
    if (this.ranges && this.ranges.length > 0) {
      // Segmented download - resume from manifest
      if (!fs.existsSync(this.manifestPath)) {
        this.emit('error', new Error('No partial meta file found to resume'));
        return;
      }
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      this.url = manifest.url;
      this.outPath = manifest.outPath;
      this.size = manifest.size;
      this.ranges = manifest.ranges;
      this.directUrl = manifest.directUrl; // Restore direct URL
      this.aborted = false;
      this.completed = false;

      // Calculate downloaded so far from ranges
      this.downloaded = this.ranges.reduce((acc, r) => acc + r.downloaded, 0);

      // We must reopen the file handle for random writes
      fs.promises.open(this.outPath, 'r+').then(fd => {
        this.fileHandle = fd;
        this._startSpeedTicker();
        this._runRanges();
      }).catch(err => {
        this.emit('error', new Error('Failed to open file for resume: ' + err.message));
      });

    } else {
      // Streaming download - cannot resume, start fresh
      this.downloaded = 0;
      this.aborted = false;
      this.completed = false;
      if (this.url.includes('youtube.com') || this.url.includes('youtu.be')) {
        this._startSpeedTicker();
        this._startYouTubeDownload();
      } else {
        this._startSpeedTicker();
        this._streamDownload();
      }
    }
    this.emit('resumed', { id: this.id, downloaded: this.downloaded });
  }

  cancel() {
    this.pause();
    try { fs.unlinkSync(this.outPath); } catch (e) { }
    try { fs.unlinkSync(this.manifestPath); } catch (e) { }
    this.emit('cancelled', { id: this.id });
  }
}

class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this.counter = 1;

    // Use Advanced QueueManager
    this.queueManager = new QueueManager(this);

    this._fetchSettings();
  }

  async _fetchSettings() {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/settings');
      if (res.ok) {
        const data = await res.json();
        // Sync setting to queue manager
        this.queueManager.updateSettings(data);
      }
    } catch (e) {
      console.log('[DownloadManager] API not ready to fetch settings yet. Using defaults.');
    }
  }


  setPersistencePath(path) {
    this.statePath = path;
  }

  saveState() {
    if (!this.statePath) return;
    const tasksData = Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      url: t.url,
      outPath: t.outPath,
      size: t.size,
      downloaded: t.downloaded,
      progress: t.size ? (t.downloaded / t.size) * 100 : 0,
      status: t.error ? 'error' : (t.aborted ? 'paused' : (t.completed ? 'completed' : 'downloading')),
      dateAdded: t.dateAdded || new Date().toISOString(),
      ranges: t.ranges,
      error: t.error ? t.error.message : null,
      completed: t.completed // persist completed flag
    }));
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(tasksData, null, 2));
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }

  loadState(tasksData) {
    try {
      if (!tasksData) return;
      for (const tData of tasksData) {
        // Reconstruct task
        const task = new DownloadTask(tData.id, tData.url, tData.file_path || tData.filePath || tData.outPath, {});
        task.size = tData.size || 0;
        task.downloaded = tData.progress ? Math.floor((tData.progress / 100) * task.size) : 0;
        task.ranges = [];
        task.aborted = tData.status === 'paused' || tData.status === 'failed' || tData.status === 'error';
        task.error = (tData.status === 'failed' || tData.status === 'error') ? new Error('Previous error') : null;
        task.completed = tData.status === 'completed';

        // If it was downloading, it's now paused on restore unless we resume everything magically
        if (tData.status === 'downloading') task.aborted = true;

        this.tasks.set(task.id, task);

        // Crash recovery: automatically restore unfinished downloads gracefully
        if (tData.status === 'downloading' || tData.status === 'queued' || tData.status === 'scheduled' || tData.status === 'retrying') {
          console.log(`[CrashRecovery] Re-queuing unfinished task: ${task.id} (Status: ${tData.status})`);
          task.aborted = false;
          this.queueManager.enqueue(task.id, {
            priority: tData.priority || 'normal',
            scheduledAt: tData.scheduledAt,
            retryCount: tData.retryCount || 0,
            status: tData.status
          });
        }
      }
      this.counter = tasksData.length > 0 ? tasksData.length + 1 : 1;
      this.queueManager.processQueue();
    } catch (e) {
      console.error('Failed to load state:', e);
    }
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      url: t.url,
      outPath: t.outPath,
      size: t.size,
      downloaded: t.downloaded,
      priority: t.priority || 'normal',
      scheduledAt: t.scheduledAt,
      retryCount: t.retryCount || 0,
      status: t.error ? 'error' : (t.aborted ? 'paused' : (t.completed ? 'completed' : (t.status || 'downloading'))),
    }));
  }

  delete(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.cancel();
      this.queueManager.remove(id);
      this.tasks.delete(id);
      return true;
    }
    return false;
  }

  async create(url, outPath, options, id) {
    const newId = id || `dl-${Date.now()}-${this.counter++}`;

    // Use classifier to intelligently route task type
    let meta = null;
    try {
      meta = await classify(url, options.headers || {});
    } catch (e) {
      console.warn('[DownloadManager] classify() failed, falling back to DownloadTask:', e.message);
    }

    // Allow explicit override from caller (e.g. from IPC with pre-classified data)
    const protocol = options.protocol || (meta && meta.protocol) || 'direct';
    const isYtdl = options.type === 'youtube' || (meta && meta.requiresYtdl);
    const isStream = protocol === 'hls' || protocol === 'dash' || options.type === 'stream';

    let task;
    if (isStream) {
      task = new StreamTask(newId, url, outPath, { ...options, variantUrl: options.variantUrl });
    } else if (isYtdl) {
      // YouTube path — use standard DownloadTask which has _startYouTubeDownload() inside
      task = new DownloadTask(newId, url, outPath, options);
    } else if (protocol === 'direct') {
      // Attempt segmented download for direct files
      task = new SegmentedDownloader(newId, url, outPath, options);

      // Listen for fallback event if server doesn't support ranges
      task.once('_fallback', async ({ reason, size }) => {
        console.log(`[DownloadManager] SegmentedDownloader fallback (${reason}), switching to standard DownloadTask`);
        const fallbackTask = new DownloadTask(newId, url, outPath, options);
        fallbackTask.size = size;

        // Replace the task in the map and transfer event listeners
        this.tasks.set(newId, fallbackTask);
        this._attachTaskListeners(fallbackTask, newId);

        // Notify QueueManager of the swap if the task is already active
        if (this.queueManager.active.has(newId)) {
          this.queueManager.active.set(newId, fallbackTask);
          // Reinstate handlers on the new task
          this.queueManager._attachTaskHandlers(fallbackTask);
          // Start the fallback
          fallbackTask.start().catch(err => {
            console.error(`[DownloadManager] Fallback task start failed:`, err.message);
          });
        }
      });
    } else {
      task = new DownloadTask(newId, url, outPath, options);
    }

    // Attach resolved metadata for display purposes
    if (meta) {
      task.classifiedMeta = meta;
      if (!task.size && meta.size) task.size = meta.size;
    }

    this.tasks.set(newId, task);
    this._attachTaskListeners(task, newId);

    // Enter advanced queue instead of auto-starting
    this.queueManager.enqueue(newId, options);

    return task;
  }

  /**
   * Helper to attach all necessary event listeners to a task.
   */
  _attachTaskListeners(task, id) {
    task.on('progress', (p) => {
      this.emit('download', { id, event: 'progress', payload: p });
      this.saveState();
    });
    task.on('finished', (p) => {
      this.emit('download', { id, event: 'finished', payload: p });
      this.saveState();
    });
    task.on('error', (e) => {
      task.error = e;
      this.emit('download', { id, event: 'error', payload: { message: e.message } });
      this.saveState();
    });
    task.on('started', (p) => {
      task.error = null;
      this.emit('download', { id, event: 'started', payload: p });
      this.saveState();
    });
    task.on('paused', () => {
      this.emit('download', { id, event: 'paused' });
      this.saveState();
    });
    task.on('resumed', (p) => {
      this.emit('download', { id, event: 'resumed', payload: p });
      this.saveState();
    });
    task.on('cancelled', (p) => {
      this.emit('download', { id, event: 'cancelled', payload: p });
      this.saveState();
    });
    task.on('merging', (p) => {
      this.emit('download', { id, event: 'merging', payload: p });
    });
    task.on('live-stream', () => {
      this.emit('download', { id, event: 'error', payload: { message: 'Live streams are not supported.' } });
    });
  }

  /**
   * Stop and remove a task completely
   */
  delete(id) {
    console.log(`[DownloadManager] Deleting task: ${id}`);
    const task = this.tasks.get(id);
    if (task) {
      if (task.pause) task.pause();
      this.tasks.delete(id);
    }
    this.queueManager.remove(id);
    this.saveState();
    return true;
  }
}

module.exports = { DownloadManager, DownloadTask };
