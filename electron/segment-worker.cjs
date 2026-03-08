/**
 * Nexus Manager — Segment Worker (Phase 7)
 * Downloads a single byte range from a URL with retry + exponential backoff.
 * Writes directly to a dedicated .part file.
 */

'use strict';

const fs = require('fs');
const EventEmitter = require('events');
const { requestWithRedirect } = require('./request-utils.cjs');

const MAX_RETRIES = 5;

/**
 * Download a single byte range to a .part file.
 *
 * @param {object} segment - { index, start, end, partPath }
 * @param {string} url
 * @param {object} headers - Custom headers (cookies, user agent, etc.)
 * @param {function} onProgress - Called with (bytesChunk) as data arrives
 * @param {object} abort - { signal: false } — set signal=true to abort
 * @param {number} speedLimit - Bytes per second (0 = unlimited)
 * @returns {Promise<void>}
 */
function downloadSegment(segment, url, headers = {}, onProgress = () => { }, abort = {}, speedLimit = 0) {
    return new Promise(async (resolve, reject) => {
        const { index, start, end, partPath } = segment;

        let attempt = 0;
        let delay = 500;
        let downloaded = 0;

        // Check if we have a partial .part file (resume within segment)
        try {
            const stat = fs.existsSync(partPath) ? fs.statSync(partPath) : null;
            if (stat && stat.size > 0) {
                downloaded = stat.size;
            }
        } catch (_) { }

        while (attempt <= MAX_RETRIES) {
            if (abort.signal) return reject(new Error('Aborted'));

            try {
                await _doRequest(url, start + downloaded, end, partPath, downloaded, headers, onProgress, abort, speedLimit);
                return resolve(); // Success
            } catch (err) {
                attempt++;
                if (attempt > MAX_RETRIES || abort.signal) {
                    return reject(new Error(`Segment ${index} failed after ${MAX_RETRIES} retries: ${err.message}`));
                }
                console.warn(`[SegmentWorker] Segment ${index} attempt ${attempt} failed — retrying in ${delay}ms`);
                await _sleep(delay);
                delay = Math.min(delay * 2, 8000); // Exponential backoff, cap at 8s

                // Re-check how much we have on disk before retrying
                try {
                    const stat = fs.existsSync(partPath) ? fs.statSync(partPath) : null;
                    downloaded = stat ? stat.size : 0;
                } catch (_) { }
            }
        }
    });
}

async function _doRequest(url, rangeStart, rangeEnd, partPath, existingBytes, headers, onProgress, abort, speedLimit) {
    const flag = existingBytes > 0 ? 'a' : 'w';
    const writeStream = fs.createWriteStream(partPath, { flags: flag });

    try {
        const res = await requestWithRedirect(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                ...headers,
                'Range': `bytes=${rangeStart}-${rangeEnd}`,
            },
        });

        if (res.statusCode >= 400) {
            writeStream.destroy();
            throw new Error(`HTTP ${res.statusCode} for segment`);
        }

        return new Promise((resolve, reject) => {
            res.on('data', async (chunk) => {
                if (abort.signal) {
                    res.destroy();
                    writeStream.destroy();
                    return reject(new Error('Aborted'));
                }

                if (!writeStream.write(chunk)) {
                    res.pause();
                    writeStream.once('drain', () => {
                        res.resume();
                    });
                }
                onProgress(chunk.length);

                if (speedLimit > 0) {
                    const delay = (chunk.length / speedLimit) * 1000;
                    if (delay > 2) {
                        res.pause();
                        await _sleep(Math.min(delay, 2000));
                        res.resume();
                    }
                }
            });

            res.on('end', () => {
                writeStream.end(() => resolve());
            });

            res.on('error', (err) => {
                writeStream.destroy();
                reject(err);
            });
        });
    } catch (err) {
        writeStream.destroy();
        throw err;
    }
}

function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

module.exports = { downloadSegment };
