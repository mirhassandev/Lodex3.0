const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const EventEmitter = require('events');
const ytdl = require('@distube/ytdl-core');

class DownloadTask extends EventEmitter {
  constructor(id, url, outPath, options = {}) {
    super();
    this.id = id;
    this.url = url;
    this.outPath = outPath;
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
    this.manifestPath = `${outPath}.download.json`;
    this.ytdlStream = null;
    this.resolution = options.resolution;
    this.title = options.title;
  }

  async headRequest() {
    const urlObj = new URL(this.url);
    const lib = urlObj.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          method: 'HEAD',
          host: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          port: urlObj.port || undefined,
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        },
        (res) => {
          const length = parseInt(res.headers['content-length'] || '0', 10);
          const acceptRanges = res.headers['accept-ranges'] === 'bytes';
          resolve({ length, acceptRanges, headers: res.headers });
        },
      );

      req.on('error', () => {
        // HEAD request failed, return empty result to trigger GET fallback
        resolve({ length: 0, acceptRanges: false, headers: {} });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ length: 0, acceptRanges: false, headers: {} });
      });
      req.end();
    });
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
    if (this.fileHandle) return; // already started

    // Check for YouTube
    if (this.url.includes('youtube.com') || this.url.includes('youtu.be')) {
      return this._startYouTubeDownload();
    }

    const head = await this.headRequest();

    // If we got content-length and server supports ranges, use segmented download
    if (head.length > 0 && head.acceptRanges) {
      this.size = head.length;
      this.ranges = this.splitRanges(this.size, this.connections);

      // create or truncate output file to the full size
      await fs.promises.writeFile(this.outPath, Buffer.alloc(1), { flag: 'w' });
      const fd = await fs.promises.open(this.outPath, 'r+');
      this.fileHandle = fd;

      this.emit('started', { id: this.id, size: this.size });
      this._runRanges();
    } else {
      // Fallback to simple streaming download (for video hosts, etc.)
      return await this._streamDownload();
    }
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

      // If we have a specific resolution, use yt-dlp to handle format selection and muxing
      // Syntax: bestvideo[height<=?1080]+bestaudio/best[height<=?1080]
      const height = this.resolution ? parseInt(this.resolution, 10) : 1080;
      const formatStr = `bestvideo[height<=?${height}]+bestaudio/best[height<=?${height}]`;

      const args = [
        this.url,
        '--format', formatStr,
        '--ffmpeg-location', ffmpegPath,
        '--merge-output-format', 'mp4',
        '--output', this.outPath,
        '--force-overwrites',
        '--no-playlist',
        '--newline',
        '--add-header', 'referer:youtube.com',
        '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      ];

      const subprocess = spawn(ytpPath, args);
      this.ytdlStream = subprocess;

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
              this.emit('progress', { id: this.id, downloaded: this.downloaded, total: this.size });
            }
          }
        }
      });

      subprocess.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
      });

      subprocess.on('close', (code) => {
        if (code === 0) {
          this.completed = true;
          this.emit('finished', { id: this.id, path: this.outPath });
        } else if (!this.aborted) {
          this.emit('error', new Error(`yt-dlp exited with code ${code}`));
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
    const urlObj = new URL(this.url);
    const lib = urlObj.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          method: 'GET',
          host: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          port: urlObj.port || undefined,
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        },
        async (res) => {
          if (res.statusCode >= 400) {
            const error = new Error(`HTTP ${res.statusCode}`);
            this.emit('error', error);
            reject(error);
            return;
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          if (contentLength > 0) {
            this.size = contentLength;
            this.emit('started', { id: this.id, size: contentLength });
          } else {
            // No content-length, emit started with unknown size
            this.emit('started', { id: this.id, size: 0 });
          }

          // Create writable file stream
          const writeStream = fs.createWriteStream(this.outPath);

          res.on('data', (chunk) => {
            this.downloaded += chunk.length;
            this.emit('progress', { id: this.id, downloaded: this.downloaded, total: this.size });
          });

          res.pipe(writeStream);

          writeStream.on('finish', () => {
            this.completed = true; // Mark completed
            this.emit('finished', { id: this.id, path: this.outPath });
            resolve();
          });

          writeStream.on('error', (err) => {
            this.emit('error', err);
            reject(err);
          });

          res.on('error', (err) => {
            this.emit('error', err);
            reject(err);
          });
        }
      );

      req.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        const error = new Error('Request timeout');
        this.emit('error', error);
        reject(error);
      });

      req.end();
      this.requests.push(req);
    });
  }

  async _runRanges() {
    // Use directUrl if set (for YouTube), otherwise this.url
    const useUrl = this.directUrl || this.url;
    const urlObj = new URL(useUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const active = [];

    const nextRange = () => this.ranges.find(r => !r.done && !r.inFlight);

    const startRequestFor = (range) => {
      range.inFlight = true;
      const options = {
        method: 'GET',
        host: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        port: urlObj.port || undefined,
        headers: {
          Range: `bytes=${range.start + range.downloaded}-${range.end}`,
        },
        // Important for YouTube direct URLs to avoid some 403s if agent varies?
        // But usually stripped.
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode >= 400) {
          this.emit('error', new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', async (chunk) => {
          // write chunk at correct offset
          res.pause();
          const writeOffset = range.start + range.downloaded;
          try {
            await this.fileHandle.write(chunk, 0, chunk.length, writeOffset);
            range.downloaded += chunk.length;
            this.downloaded += chunk.length;
            this.emit('progress', { id: this.id, downloaded: this.downloaded, total: this.size });
            res.resume();
          } catch (err) {
            this.emit('error', err);
            req.destroy();
          }
        });

        res.on('end', () => {
          range.done = range.downloaded >= (range.end - range.start + 1);
          range.inFlight = false;
          // start another range if available
          const nr = nextRange();
          if (nr) startRequestFor(nr);
          this._checkComplete();
        });

        res.on('error', (err) => {
          this.emit('error', err);
        });
      });

      req.on('error', (err) => {
        range.inFlight = false;
        this.emit('error', err);
      });

      req.end();
      this.requests.push(req);
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
      this.completed = true; // Mark completed
      this.emit('finished', { id: this.id, path: this.outPath });
      if (this.fileHandle) this.fileHandle.close().catch(() => { });
      // cleanup manifest if exists
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
        this.emit('error', new Error('No manifest to resume'));
        return;
      }
      const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      this.url = manifest.url;
      this.outPath = manifest.outPath;
      this.size = manifest.size;
      this.ranges = manifest.ranges;
      this.directUrl = manifest.directUrl; // Restore direct URL
      this.aborted = false;
      this._runRanges();
    } else {
      // Streaming download - cannot resume, start fresh
      this.downloaded = 0;
      this.aborted = false;
      if (this.url.includes('youtube.com') || this.url.includes('youtu.be')) {
        this._startYouTubeDownload();
      } else {
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
    this.statePath = '';
  }

  setPersistencePath(path) {
    this.statePath = path;
    this.loadState();
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

  loadState() {
    if (!this.statePath || !fs.existsSync(this.statePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      for (const tData of data) {
        // Reconstruct task
        const task = new DownloadTask(tData.id, tData.url, tData.outPath, {});
        task.size = tData.size;
        task.downloaded = tData.downloaded;
        task.ranges = tData.ranges || [];
        task.aborted = tData.status === 'paused' || tData.status === 'error';
        task.error = tData.error ? new Error(tData.error) : null;
        task.completed = tData.completed || (tData.status === 'completed'); // restore

        // If it was downloading, it's now paused on restore
        if (tData.status === 'downloading') task.aborted = true;
        if (tData.status === 'error') task.error = true;

        this.tasks.set(task.id, task);
      }
      this.counter = data.length > 0 ? Math.max(...data.map(d => parseInt(d.id.split('-').pop()) || 0)) + 1 : 1;
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
      status: t.error ? 'error' : (t.aborted ? 'paused' : (t.completed ? 'completed' : 'downloading')),
    }));
  }

  delete(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.cancel(); // Implement cancel in DownloadTask if not fully destructive, but we want file gone too usually.
      // Check if cancel deletes file. It does.
      this.tasks.delete(id);
      this.saveState();
      return true;
    }
    return false;
  }

  create(url, outPath, options) {
    const id = `dl-${Date.now()}-${this.counter++}`;
    const task = new DownloadTask(id, url, outPath, options);
    this.tasks.set(id, task);
    task.on('progress', (p) => { this.emit('download', { id, event: 'progress', payload: p }); this.saveState(); });
    task.on('finished', (p) => { this.emit('download', { id, event: 'finished', payload: p }); this.saveState(); });
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
    task.on('paused', () => { this.emit('download', { id, event: 'paused' }); this.saveState(); });
    task.on('resumed', (p) => { this.emit('download', { id, event: 'resumed', payload: p }); this.saveState(); });
    task.on('cancelled', (p) => { this.emit('download', { id, event: 'cancelled', payload: p }); this.saveState(); });
    return task;
  }
}

module.exports = { DownloadManager, DownloadTask };
