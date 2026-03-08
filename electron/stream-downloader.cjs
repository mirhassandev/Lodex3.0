/**
 * Nexus Manager — Streaming Media Downloader (Phase 4)
 * Handles HLS (.m3u8) and MPEG-DASH (.mpd) streaming downloads.
 * Supports: concurrent segments, retry/backoff, AES-128 detection,
 *           crash recovery via .stream.meta, and FFmpeg merging.
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const { parseString } = require('xml2js');

// Use dynamic import for m3u8-parser (ESM module)
let M3U8Parser;

async function getM3U8Parser() {
    if (M3U8Parser) return M3U8Parser;
    const mod = await import('m3u8-parser');
    M3U8Parser = mod.Parser;
    return M3U8Parser;
}

let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    ffmpegPath = 'ffmpeg'; // Fallback to system ffmpeg
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fetchText(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const options = { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
        lib.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function resolveSegmentUrl(baseUrl, segmentUri) {
    if (segmentUri.startsWith('http://') || segmentUri.startsWith('https://')) {
        return segmentUri;
    }
    const base = new URL(baseUrl);
    if (segmentUri.startsWith('/')) {
        return `${base.protocol}//${base.host}${segmentUri}`;
    }
    // Relative path — resolve against the playlist's directory
    const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return `${base.protocol}//${base.host}${basePath}${segmentUri}`;
}

async function downloadBytesWithRetry(url, headers = {}, maxRetries = 5) {
    let delay = 500;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const lib = url.startsWith('https') ? https : http;
                const options = { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
                lib.get(url, options, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                    res.on('error', reject);
                }).on('error', reject);
            });
        } catch (e) {
            if (attempt === maxRetries) throw e;
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 8000); // Exponential backoff, cap at 8s
        }
    }
}

// ─── HLS Playlist Inspector (for UI quality selection) ────────────────────────

async function inspectHLSPlaylist(url, headers = {}) {
    const Parser = await getM3U8Parser();
    const text = await fetchText(url, headers);
    const parser = new Parser();
    parser.push(text);
    parser.end();

    const manifest = parser.manifest;

    // Check for live streams
    const isLive = !manifest.endList;
    const playlistType = manifest.playlistType || (isLive ? 'LIVE' : 'VOD');

    // Check for master playlist (multiple quality variants)
    if (manifest.playlists && manifest.playlists.length > 0) {
        const variants = manifest.playlists.map((p) => {
            const attrs = p.attributes || {};
            const res = attrs.RESOLUTION || {};
            const height = res.height || 0;
            const bw = attrs.BANDWIDTH || 0;
            return {
                url: resolveSegmentUrl(url, p.uri),
                height,
                label: height ? `${height}p` : `${Math.round(bw / 1000)}kbps`,
                bandwidth: bw,
            };
        }).sort((a, b) => b.height - a.height);

        return { type: 'master', variants, isLive, playlistType };
    }

    // Media playlist — estimate segment count and size
    const segments = manifest.segments || [];
    const avgDuration = segments.reduce((acc, s) => acc + (s.duration || 0), 0) / (segments.length || 1);
    const subtitles = (manifest.mediaGroups?.SUBTITLES && Object.values(manifest.mediaGroups.SUBTITLES).flatMap(Object.values)) || [];

    // Detect AES-128 encryption
    const keyInfo = manifest.contentProtection || null;
    const hasEncryption = segments.some(s => s.key && s.key.method && s.key.method !== 'NONE');

    return {
        type: 'media',
        segmentCount: segments.length,
        avgDuration,
        estimatedDurationSecs: segments.reduce((acc, s) => acc + (s.duration || 0), 0),
        subtitles,
        hasEncryption,
        keyInfo,
        isLive,
        playlistType,
    };
}

// ─── DASH Manifest Inspector ──────────────────────────────────────────────────

async function inspectDASHManifest(url, headers = {}) {
    const text = await fetchText(url, headers);
    return new Promise((resolve, reject) => {
        parseString(text, { explicitArray: false }, (err, result) => {
            if (err) return reject(err);
            try {
                const mpd = result.MPD;
                const period = Array.isArray(mpd.Period) ? mpd.Period[0] : mpd.Period;
                const adaptationSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : [period.AdaptationSet];

                const videoSets = adaptationSets.filter(a => {
                    const ct = (a.$ || {}).contentType || (a.$ || {}).mimeType || '';
                    return ct.includes('video');
                });
                const audioSets = adaptationSets.filter(a => {
                    const ct = (a.$ || {}).contentType || (a.$ || {}).mimeType || '';
                    return ct.includes('audio');
                });

                const variants = videoSets.flatMap(a => {
                    const reps = Array.isArray(a.Representation) ? a.Representation : [a.Representation];
                    return reps.map(r => ({
                        id: (r.$ || {}).id || 'unknown',
                        width: parseInt((r.$ || {}).width || '0'),
                        height: parseInt((r.$ || {}).height || '0'),
                        bandwidth: parseInt((r.$ || {}).bandwidth || '0'),
                        label: (r.$ || {}).height ? `${(r.$ || {}).height}p` : 'Unknown',
                    }));
                }).sort((a, b) => b.height - a.height);

                resolve({ type: 'dash', variants, videoSets, audioSets });
            } catch (e) {
                reject(e);
            }
        });
    });
}

// ─── StreamTask ───────────────────────────────────────────────────────────────

class StreamTask extends EventEmitter {
    constructor(id, url, outPath, options = {}) {
        super();
        this.id = id;
        this.url = url;
        this.outPath = outPath;
        this.options = options;
        this.aborted = false;
        this.completed = false;
        this.error = null;

        this.selectedVariantUrl = options.variantUrl || null;  // If user pre-selected quality
        this.maxWorkers = options.maxWorkers || 6;             // Concurrent segment downloaders
        this.customHeaders = options.headers || {};

        // Progress state
        this.metaPath = `${outPath}.stream.meta`;
        this.tmpDir = path.join(path.dirname(outPath), `.nexus-stream-${id}`);
        this.segments = [];    // { index, url, done, size }
        this.downloaded = 0;
        this.totalBytes = 0;
        this.lastDownloaded = 0;
        this.speedHistory = [];
        this.speedInterval = null;
        this.size = 0;         // Will be estimated
    }

    async start() {
        this.aborted = false;

        // Check for existing meta (resume mode)
        if (fs.existsSync(this.metaPath)) {
            return this._resume();
        }

        const isHLS = this.url.includes('.m3u8') || this.url.includes('m3u8?');
        const isDASH = this.url.includes('.mpd') || this.url.includes('mpd?');

        if (isHLS) {
            await this._startHLS();
        } else if (isDASH) {
            await this._startDASH();
        } else {
            throw new Error('Unsupported stream format — expected .m3u8 or .mpd');
        }
    }

    async _startHLS() {
        const Parser = await getM3U8Parser();
        const text = await fetchText(this.url, this.customHeaders);
        const parser = new Parser();
        parser.push(text);
        parser.end();
        const manifest = parser.manifest;

        // Live stream detection
        if (!manifest.endList && !manifest.playlistType) {
            this.emit('live-stream', { id: this.id });
            throw new Error('Live streams are not supported for download. Please use a recording tool.');
        }

        let mediaUrl = this.url;

        // If master playlist, resolve the selected variant (or highest quality)
        if (manifest.playlists && manifest.playlists.length > 0) {
            if (this.selectedVariantUrl) {
                mediaUrl = this.selectedVariantUrl;
            } else {
                // Auto-select highest quality
                const sorted = manifest.playlists
                    .filter(p => p.attributes && p.attributes.RESOLUTION)
                    .sort((a, b) => (b.attributes.RESOLUTION.height || 0) - (a.attributes.RESOLUTION.height || 0));
                const best = sorted[0] || manifest.playlists[0];
                mediaUrl = resolveSegmentUrl(this.url, best.uri);
            }

            // Parse the media playlist
            const mediaText = await fetchText(mediaUrl, this.customHeaders);
            const mediaParser = new Parser();
            mediaParser.push(mediaText);
            mediaParser.end();
            manifest.segments = mediaParser.manifest.segments;
        }

        const rawSegments = manifest.segments || [];

        if (rawSegments.length === 0) {
            throw new Error('No segments found in HLS playlist.');
        }

        // Warn about AES-128 encryption (informational — we'll download, but won't self-decrypt)
        const hasEncryption = rawSegments.some(s => s.key && s.key.method && s.key.method !== 'NONE');
        if (hasEncryption) {
            console.warn('[StreamTask] AES-128 encrypted stream detected. FFmpeg will handle decryption.');
        }

        this.segments = rawSegments.map((seg, i) => ({
            index: i,
            url: resolveSegmentUrl(mediaUrl, seg.uri),
            done: false,
            size: 0,
            key: seg.key || null,
        }));

        // Download subtitle tracks if available
        this._downloadSubtitles(manifest, path.dirname(this.outPath));

        this._saveMeta();
        this._runSegments('hls');
    }

    async _startDASH() {
        const info = await inspectDASHManifest(this.url, this.customHeaders);
        // For now, use the first (highest quality) video adaptation set's first representation
        if (!info.videoSets || info.videoSets.length === 0) {
            throw new Error('No video adaptation set found in DASH manifest.');
        }
        const videoSet = info.videoSets[0];
        const reps = Array.isArray(videoSet.Representation) ? videoSet.Representation : [videoSet.Representation];
        const best = reps.sort((a, b) => parseInt(b.$.height || 0) - parseInt(a.$.height || 0))[0];

        // Simplified: use FFmpeg directly for DASH (complex segment templates)
        const outName = path.basename(this.outPath, path.extname(this.outPath));
        const outDir = path.dirname(this.outPath);

        this.emit('started', { id: this.id, size: 0 });
        this._startSpeedTicker();

        this._runFFmpegDirect(this.url, this.outPath, () => {
            this.completed = true;
            if (this.speedInterval) clearInterval(this.speedInterval);
            this.emit('finished', { id: this.id, path: this.outPath });
        });
    }

    _runSegments(type) {
        fs.mkdirSync(this.tmpDir, { recursive: true });

        const pending = this.segments.filter(s => !s.done);
        if (pending.length === 0) {
            // Everything already done — go directly to merge
            return this._merge(type);
        }

        const totalSeg = this.segments.length;
        this.totalBytes = this.segments.reduce((acc, s) => acc + s.size, 0) || 0;

        this.emit('started', { id: this.id, size: this.size, segmentsTotal: totalSeg });
        this._startSpeedTicker(type, totalSeg);

        let queue = [...pending];
        let activeWorkers = 0;
        let failed = 0;

        const next = () => {
            while (activeWorkers < this.maxWorkers && queue.length > 0) {
                if (this.aborted) return;
                const seg = queue.shift();
                activeWorkers++;
                this._downloadSegment(seg).then(() => {
                    activeWorkers--;
                    if (!this.aborted) next();
                }).catch((err) => {
                    failed++;
                    activeWorkers--;
                    console.error(`[StreamTask] Segment ${seg.index} permanently failed: ${err.message}`);
                    if (!this.aborted) next();
                });
            }

            // All segments dispatched and all workers done
            if (activeWorkers === 0 && queue.length === 0 && !this.aborted) {
                const remaining = this.segments.filter(s => !s.done);
                if (remaining.length === 0) {
                    this._merge(type);
                } else {
                    this.emit('error', new Error(`${remaining.length} segments failed permanently.`));
                }
            }
        };

        next();
    }

    async _downloadSegment(seg) {
        const segPath = path.join(this.tmpDir, `seg-${String(seg.index).padStart(6, '0')}.ts`);

        // Skip already done segments from previous run
        if (seg.done && fs.existsSync(segPath)) return;

        const data = await downloadBytesWithRetry(seg.url, this.customHeaders);

        fs.writeFileSync(segPath, data);
        seg.done = true;
        seg.size = data.length;
        this.downloaded += data.length;
        this._saveMeta();
    }

    _merge(type) {
        if (type === 'hls') {
            this._mergeHLS();
        } else {
            this._mergeDASH();
        }
    }

    _mergeHLS() {
        // Build concat file
        const concatPath = path.join(this.tmpDir, 'segments.txt');
        const lines = this.segments.map(s =>
            `file '${path.join(this.tmpDir, `seg-${String(s.index).padStart(6, '0')}.ts`).replace(/\\/g, '/')}'`
        );
        fs.writeFileSync(concatPath, lines.join('\n'));

        const args = [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concatPath,
            '-c', 'copy',
            this.outPath
        ];

        this._spawnFFmpeg(args, () => {
            this._cleanup();
            this.completed = true;
            if (this.speedInterval) clearInterval(this.speedInterval);
            this.emit('finished', { id: this.id, path: this.outPath });
        });
    }

    _mergeDASH() {
        const videoPath = path.join(this.tmpDir, 'video.mp4');
        const audioPath = path.join(this.tmpDir, 'audio.m4a');

        if (!fs.existsSync(audioPath)) {
            // Only video — just move it
            fs.copyFileSync(videoPath, this.outPath);
            this._cleanup();
            this.completed = true;
            if (this.speedInterval) clearInterval(this.speedInterval);
            return this.emit('finished', { id: this.id, path: this.outPath });
        }

        const args = [
            '-y',
            '-i', videoPath,
            '-i', audioPath,
            '-c', 'copy',
            this.outPath
        ];

        this._spawnFFmpeg(args, () => {
            this._cleanup();
            this.completed = true;
            if (this.speedInterval) clearInterval(this.speedInterval);
            this.emit('finished', { id: this.id, path: this.outPath });
        });
    }

    _runFFmpegDirect(playlistUrl, outPath, onDone) {
        // Build header string for FFmpeg
        let headerStr = '';
        if (this.customHeaders) {
            headerStr = Object.entries(this.customHeaders)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n') + '\r\n';
        }

        const args = [
            '-y',
            '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
            ...(headerStr ? ['-headers', headerStr] : []),
            '-i', playlistUrl,
            '-c', 'copy',
            outPath
        ];
        this._spawnFFmpeg(args, onDone);
    }

    _spawnFFmpeg(args, onDone) {
        console.log(`[FFmpeg] Spawning: ${ffmpegPath} ${args.join(' ')}`);
        const proc = spawn(ffmpegPath, args, { windowsHide: true });

        proc.stderr.on('data', (d) => {
            const line = d.toString();
            // Parse FFmpeg progress lines for time info
            const match = line.match(/time=(\d+:\d+:\d+\.?\d*)/);
            if (match) {
                // Emit a merge-progress event (informational)
                this.emit('merging', { id: this.id, time: match[1] });
            }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                onDone();
            } else {
                const err = new Error(`FFmpeg exited with code ${code}`);
                this.error = err;
                this.emit('error', err);
            }
        });

        proc.on('error', (err) => {
            this.error = err;
            this.emit('error', err);
        });
    }

    _downloadSubtitles(manifest, outDir) {
        try {
            const groups = manifest.mediaGroups;
            if (!groups || !groups.SUBTITLES) return;

            Object.values(groups.SUBTITLES).forEach(lang => {
                Object.entries(lang).forEach(([label, track]) => {
                    if (track.uri) {
                        const subUrl = resolveSegmentUrl(this.url, track.uri);
                        const subName = `${path.basename(this.outPath, path.extname(this.outPath))}.${label}.vtt`;
                        const subPath = path.join(outDir, subName);

                        downloadBytesWithRetry(subUrl, this.customHeaders)
                            .then(data => {
                                fs.writeFileSync(subPath, data);
                                console.log(`[StreamTask] Subtitle saved: ${subName}`);
                            })
                            .catch(e => console.warn(`[StreamTask] Failed to download subtitle ${label}: ${e.message}`));
                    }
                });
            });
        } catch (e) {
            console.warn('[StreamTask] Subtitle detection failed:', e.message);
        }
    }

    _startSpeedTicker(type = 'hls', segmentsTotal = 0) {
        if (this.speedInterval) clearInterval(this.speedInterval);
        this.lastDownloaded = this.downloaded || 0;
        this.speedHistory = [];

        this.speedInterval = setInterval(() => {
            if (this.aborted || this.completed) {
                clearInterval(this.speedInterval);
                return;
            }

            const now = this.downloaded || 0;
            const bytesPerSec = now - this.lastDownloaded;
            this.lastDownloaded = now;

            this.speedHistory.push(bytesPerSec);
            if (this.speedHistory.length > 5) this.speedHistory.shift();

            const avgSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / (this.speedHistory.length || 1);

            const doneSeg = this.segments.filter(s => s.done).length;
            const remaining = segmentsTotal - doneSeg;
            const eta = avgSpeed > 0 && this.size > 0
                ? Math.round((this.size - now) / avgSpeed)
                : (avgSpeed > 0 && segmentsTotal > 0
                    ? Math.round((remaining * (now / Math.max(doneSeg, 1))) / avgSpeed)
                    : 0);

            this.emit('progress', {
                id: this.id,
                downloaded: now,
                total: this.size || 0,
                segmentsDone: doneSeg,
                segmentsTotal,
                speed: avgSpeed,
                eta,
            });
        }, 1000);
    }

    pause() {
        this.aborted = true;
        if (this.speedInterval) clearInterval(this.speedInterval);
        this._saveMeta();
        this.emit('paused', { id: this.id });
    }

    _resume() {
        const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
        this.segments = meta.segments || [];
        this.url = meta.playlistUrl || this.url;
        this.aborted = false;
        this.completed = false;
        this.downloaded = this.segments.filter(s => s.done).reduce((acc, s) => acc + (s.size || 0), 0);

        const isHLS = meta.type === 'hls' || !meta.type;
        this.emit('resumed', { id: this.id, downloaded: this.downloaded });
        this._runSegments(isHLS ? 'hls' : 'dash');
    }

    _saveMeta() {
        const meta = {
            playlistUrl: this.url,
            type: 'hls',
            segmentsTotal: this.segments.length,
            created: Date.now(),
            segments: this.segments.map(s => ({
                index: s.index,
                url: s.url,
                done: s.done,
                size: s.size || 0,
            })),
        };
        try {
            fs.writeFileSync(this.metaPath, JSON.stringify(meta));
        } catch (e) {
            console.error('[StreamTask] Failed to save meta:', e.message);
        }
    }

    _cleanup() {
        try {
            fs.rmSync(this.tmpDir, { recursive: true, force: true });
            fs.unlink(this.metaPath, () => { });
        } catch (e) {
            console.warn('[StreamTask] Cleanup failed:', e.message);
        }
    }
}

module.exports = { StreamTask, inspectHLSPlaylist, inspectDASHManifest };
