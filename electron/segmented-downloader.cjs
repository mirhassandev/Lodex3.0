/**
 * Nexus Manager — Segmented Downloader (Phase 7)
 * Orchestrator that coordinates parallel segment workers,
 * tracks per-segment progress, persists crash-recovery metadata,
 * then merges .part files into the final output.
 *
 * Emits the same events as DownloadTask so the DownloadManager
 * and React UI can treat it identically:
 *   'started'  { id, size, connections }
 *   'progress' { id, downloaded, total, speed, eta, segmentsDone, segmentsTotal, connections }
 *   'merging'  { id }
 *   'finished' { id, path }
 *   'paused'   { id }
 *   'resumed'  { id }
 *   'error'    Error
 */

'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { downloadSegment } = require('./segment-worker.cjs');
const { mergeSegments, getPartPaths, cleanupParts } = require('./file-merger.cjs');
const { headWithRedirect } = require('./request-utils.cjs');

const MIN_SEGMENTED_SIZE = 5 * 1024 * 1024; // 5 MB threshold

/**
 * Perform a HEAD request and return { size, acceptRanges }.
 */
async function headRequest(url, headers = {}) {
    try {
        return await headWithRedirect(url, headers);
    } catch (e) {
        return { size: 0, acceptRanges: false, mime: '' };
    }
}

/**
 * Dynamically choose connection count based on file size.
 */
function autoConnections(sizeBytes, overrideConnections) {
    if (overrideConnections && overrideConnections > 0) return overrideConnections;
    if (sizeBytes >= 1 * 1024 * 1024 * 1024) return 16; // ≥ 1 GB
    if (sizeBytes >= 100 * 1024 * 1024) return 8;  // ≥ 100 MB
    if (sizeBytes >= 10 * 1024 * 1024) return 4;  // ≥ 10 MB
    return 2;
}

/**
 * Split [0, total) into N balanced byte ranges.
 */
function splitRanges(total, n) {
    const ranges = [];
    const chunk = Math.floor(total / n);
    let start = 0;
    for (let i = 0; i < n; i++) {
        const end = (i === n - 1) ? total - 1 : start + chunk - 1;
        ranges.push({ index: i, start, end, downloaded: 0, done: false });
        start = end + 1;
    }
    return ranges;
}

class SegmentedDownloader extends EventEmitter {
    constructor(id, url, outPath, options = {}) {
        super();
        this.id = id;
        this.url = url;
        this.outPath = outPath;
        this.options = options;
        this.customHeaders = options.headers || {};

        this.aborted = false;
        this.completed = false;
        this.error = null;
        this.merging = false;

        this.size = 0;
        this.downloaded = 0;
        this.connections = options.connections || 0; // 0 = auto
        this.headers = options.headers || {};

        this.segments = []; // [{ index, start, end, downloaded, done }]
        this.tmpDir = path.join(path.dirname(outPath), `.nexus-parts-${id}`);
        this.metaPath = `${outPath}.seg.meta`;

        // Speed tracking
        this.lastDownloaded = 0;
        this.speedHistory = [];
        this.speedInterval = null;

        // Abort control object shared with all workers
        this.abort = { signal: false };
        this.speedLimit = 0; // 0 = unlimited
    }

    // Compatibility getter for DownloadManager.saveState()
    get ranges() {
        return this.segments;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async start() {
        this.aborted = false;
        this.abort.signal = false;

        // Crash-recovery path: resume from meta
        if (fs.existsSync(this.metaPath)) {
            return this._resumeFromMeta();
        }

        // New download: probe server
        const head = await headRequest(this.url, this.customHeaders);

        // Update URL to the final redirect target if applicable
        if (head.finalUrl && head.finalUrl !== this.url) {
            console.log(`[SegmentedDownloader] Redirect detected: ${this.url} -> ${head.finalUrl}`);
            this.url = head.finalUrl;
        }

        if (head.size > MIN_SEGMENTED_SIZE && head.acceptRanges) {
            await this._startSegmented(head.size);
        } else {
            // Fallback to single-stream (handled by DownloadTask in downloader.cjs)
            this.emit('_fallback', { reason: head.acceptRanges ? 'small-file' : 'no-range-support', size: head.size });
        }
    }

    pause() {
        if (this.aborted) return;
        this.aborted = true;
        this.abort.signal = true;
        this._saveMeta();
        if (this.speedInterval) clearInterval(this.speedInterval);
        this.emit('paused', { id: this.id });
    }

    resume() {
        this.aborted = false;
        this.abort.signal = false;
        this._resumeFromMeta();
    }

    throttle(limit) {
        this.speedLimit = limit;
        console.log(`[SegmentedDownloader] Throttling for ${this.id}: ${limit} B/s`);
    }

    cancel() {
        this.aborted = true;
        this.abort.signal = true;
        if (this.speedInterval) clearInterval(this.speedInterval);
        // Remove parts and meta
        cleanupParts(getPartPaths(this.tmpDir, this.id, this.segments.length));
        try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch (_) { }
        try { fs.unlinkSync(this.metaPath); } catch (_) { }
        this.emit('cancelled', { id: this.id });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    async _startSegmented(size) {
        this.size = size;
        const connCount = autoConnections(size, this.options.connections);
        this.connections = connCount;
        this.segments = splitRanges(size, connCount);

        fs.mkdirSync(this.tmpDir, { recursive: true });
        this._saveMeta();

        this.emit('started', { id: this.id, size, connections: connCount });
        this._startSpeedTicker();
        await this._runWorkers();
    }

    async _resumeFromMeta() {
        try {
            const meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf-8'));
            this.url = meta.url || this.url;
            this.size = meta.size;
            this.connections = meta.connections;
            this.segments = meta.segments;
            this.downloaded = this.segments.reduce((a, s) => a + s.downloaded, 0);
            this.abort.signal = false;

            fs.mkdirSync(this.tmpDir, { recursive: true });

            this.emit('resumed', { id: this.id, downloaded: this.downloaded });
            this._startSpeedTicker();
            await this._runWorkers();
        } catch (e) {
            this.emit('error', new Error('Failed to load segment resume data: ' + e.message));
        }
    }

    async _runWorkers() {
        const pending = this.segments.filter(s => !s.done);
        if (pending.length === 0) {
            return this._merge();
        }

        const partPaths = getPartPaths(this.tmpDir, this.id, this.segments.length);
        let activeWorkers = 0;
        let queue = [...pending];
        let permanentFailures = 0;

        const totalSegCount = this.segments.length;

        await new Promise((resolve, reject) => {
            const next = () => {
                while (activeWorkers < this.connections && queue.length > 0) {
                    if (this.abort.signal) return;
                    const seg = queue.shift();
                    const partPath = partPaths[seg.index];
                    activeWorkers++;

                    const limitPerConn = this.speedLimit / this.connections;

                    downloadSegment(
                        { ...seg, partPath }, // Keep partPath in the segment object
                        this.url,
                        this.headers, // Changed from this.customHeaders to this.headers
                        (bytes) => {
                            seg.downloaded += bytes;
                            this.downloaded += bytes;
                            this.lastReport = Date.now();
                            this._saveMeta();
                        },
                        this.abort,
                        limitPerConn // Changed from this.speedLimit / this.connections to limitPerConn
                    )
                        .then(() => {
                            seg.done = true;
                            this._saveMeta();
                            activeWorkers--;
                            this.emit('segment-done', {
                                id: this.id,
                                segmentIndex: seg.index,
                                segmentsDone: this.segments.filter(s => s.done).length,
                                segmentsTotal: totalSegCount,
                            });
                            if (!this.abort.signal) next();
                            tryFinish();
                        })
                        .catch((err) => {
                            permanentFailures++;
                            activeWorkers--;
                            console.error(`[SegmentedDownloader] Worker ${seg.index} permanently failed:`, err.message);
                            if (!this.abort.signal) next();
                            tryFinish();
                        });
                }
            };

            const tryFinish = () => {
                if (this.abort.signal) return;
                if (activeWorkers === 0 && queue.length === 0) {
                    const pending = this.segments.filter(s => !s.done).length;
                    if (pending === 0) {
                        resolve();
                    } else {
                        reject(new Error(`${pending} segments failed permanently after retries.`));
                    }
                }
            };

            next();
        });

        if (!this.abort.signal) {
            await this._merge();
        }
    }

    async _merge() {
        this.merging = true;
        this.emit('merging', { id: this.id });

        const partPaths = getPartPaths(this.tmpDir, this.id, this.segments.length);

        try {
            await mergeSegments(partPaths, this.outPath, (merged, total) => {
                // Emit merge progress as pseudo-download progress (already at 100% data)
                this.emit('progress', {
                    id: this.id,
                    downloaded: this.size,
                    total: this.size,
                    speed: 0,
                    eta: 0,
                    segmentsDone: this.segments.length,
                    segmentsTotal: this.segments.length,
                    connections: this.connections,
                    merging: true,
                    outPath: this.outPath
                });
            });

            // Cleanup temp dir + meta
            try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch (_) { }
            try { fs.unlinkSync(this.metaPath); } catch (_) { }

            this.completed = true;
            if (this.speedInterval) clearInterval(this.speedInterval);
            this.emit('finished', { id: this.id, path: this.outPath });
        } catch (err) {
            this.error = err;
            this.emit('error', err);
        }
    }

    _startSpeedTicker() {
        if (this.speedInterval) clearInterval(this.speedInterval);
        this.lastDownloaded = this.downloaded;
        this.speedHistory = [];

        this.speedInterval = setInterval(() => {
            if (this.aborted || this.completed || this.merging) {
                clearInterval(this.speedInterval);
                return;
            }

            const now = this.downloaded;
            const bps = now - this.lastDownloaded;
            this.lastDownloaded = now;
            this.speedHistory.push(bps);
            if (this.speedHistory.length > 6) this.speedHistory.shift();

            const avgSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / (this.speedHistory.length || 1);
            const remaining = this.size - now;
            const eta = avgSpeed > 500 ? Math.round(remaining / avgSpeed) : 0;

            this.emit('progress', {
                id: this.id,
                downloaded: now,
                total: this.size,
                speed: avgSpeed,
                eta,
                segmentsDone: this.segments.filter(s => s.done).length,
                segmentsTotal: this.segments.length,
                connections: this.connections,
                merging: false,
                outPath: this.outPath
            });
        }, 1000);
    }

    _saveMeta() {
        try {
            fs.writeFileSync(this.metaPath, JSON.stringify({
                url: this.url,
                size: this.size,
                connections: this.connections,
                created: Date.now(),
                segments: this.segments.map(s => ({
                    index: s.index,
                    start: s.start,
                    end: s.end,
                    downloaded: s.downloaded,
                    done: s.done,
                })),
            }));
        } catch (e) {
            console.error('[SegmentedDownloader] Failed to save meta:', e.message);
        }
    }
}

/**
 * Lightweight helper used by DownloadManager to check range support
 * without instantiating a full task.
 */
async function canSegment(url, headers = {}) {
    const head = await headRequest(url, headers);
    return {
        canSegment: head.size > MIN_SEGMENTED_SIZE && head.acceptRanges,
        size: head.size,
        acceptRanges: head.acceptRanges,
        mime: head.mime,
    };
}

module.exports = { SegmentedDownloader, canSegment, headRequest, splitRanges };
