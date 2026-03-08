/**
 * Nexus Manager — File Merger (Phase 7)
 * Concatenates numbered .part files into a single output file using Node.js streams.
 * Deletes part files after successful merge.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Merge ordered part files into a single output file.
 *
 * @param {string[]} partPaths - Ordered array of .part file paths
 * @param {string} outPath - Final merged output path
 * @param {function} [onProgress] - Called with (mergedBytes, totalBytes)
 * @returns {Promise<void>}
 */
function mergeSegments(partPaths, outPath, onProgress = () => { }) {
    return new Promise((resolve, reject) => {
        // Validate all part files exist before starting
        for (const p of partPaths) {
            if (!fs.existsSync(p)) {
                return reject(new Error(`Part file missing before merge: ${p}`));
            }
        }

        const totalBytes = partPaths.reduce((acc, p) => {
            try { return acc + fs.statSync(p).size; } catch { return acc; }
        }, 0);

        const writeStream = fs.createWriteStream(outPath, { flags: 'w' });
        let merged = 0;
        let partIndex = 0;

        writeStream.on('error', reject);

        function appendNext() {
            if (partIndex >= partPaths.length) {
                writeStream.end(() => {
                    // Remove all part files
                    for (const p of partPaths) {
                        try { fs.unlinkSync(p); } catch (_) { }
                    }
                    resolve();
                });
                return;
            }

            const partPath = partPaths[partIndex++];
            const readStream = fs.createReadStream(partPath);

            readStream.on('data', (chunk) => {
                merged += chunk.length;
                onProgress(merged, totalBytes);
            });

            readStream.on('end', () => {
                // Don't pipe automatically — wait for drain if needed
                appendNext();
            });

            readStream.on('error', (err) => {
                writeStream.destroy();
                reject(new Error(`Failed to read part ${partPath}: ${err.message}`));
            });

            readStream.pipe(writeStream, { end: false });
        }

        appendNext();
    });
}

/**
 * Generate part file paths for a given download ID and connection count.
 * @param {string} tmpDir - Directory where parts are stored
 * @param {string} id - Download ID
 * @param {number} count - Number of segments
 * @returns {string[]}
 */
function getPartPaths(tmpDir, id, count) {
    return Array.from({ length: count }, (_, i) =>
        path.join(tmpDir, `${id}.part${i}`)
    );
}

/**
 * Clean up all part files for a download (on cancel/error).
 * @param {string[]} partPaths
 */
function cleanupParts(partPaths) {
    for (const p of partPaths) {
        try { fs.unlinkSync(p); } catch (_) { }
    }
}

module.exports = { mergeSegments, getPartPaths, cleanupParts };
