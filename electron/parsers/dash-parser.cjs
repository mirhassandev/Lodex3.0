/**
 * Nexus Manager — DASH Manifest Parser (Phase 6)
 * Parses MPEG-DASH .mpd XML to extract video/audio/subtitle tracks.
 */

'use strict';

const https = require('https');
const http = require('http');
const { parseString } = require('xml2js');

function fetchText(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('DASH fetch timeout')); });
        req.on('error', reject);
    });
}

function resolveUrl(base, uri) {
    if (!uri) return base;
    if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
    const b = new URL(base);
    if (uri.startsWith('/')) return `${b.protocol}//${b.host}${uri}`;
    const basePath = b.pathname.substring(0, b.pathname.lastIndexOf('/') + 1);
    return `${b.protocol}//${b.host}${basePath}${uri}`;
}

function toArray(val) {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
}

function getAttr(obj, key) {
    if (!obj || !obj.$) return null;
    return obj.$[key] || null;
}

/**
 * Parse ISO 8601 duration (e.g. PT1H2M3.5S) → seconds
 */
function parseDuration(str) {
    if (!str) return 0;
    const match = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
    if (!match) return 0;
    const h = parseFloat(match[1] || '0');
    const m = parseFloat(match[2] || '0');
    const s = parseFloat(match[3] || '0');
    return h * 3600 + m * 60 + s;
}

/**
 * Parse DASH manifest XML and return structured quality list.
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<object>}
 */
async function parseDASH(url, headers = {}) {
    const text = await fetchText(url, headers);

    return new Promise((resolve, reject) => {
        parseString(text, { explicitArray: true, trim: true }, (err, result) => {
            if (err) return reject(new Error('Failed to parse DASH manifest: ' + err.message));

            try {
                const mpd = result.MPD;
                const mpdAttrs = mpd.$ || {};
                const duration = parseDuration(mpdAttrs.mediaPresentationDuration || '');
                const profiles = mpdAttrs.profiles || '';
                const isLive = (mpdAttrs.type || '').toLowerCase() === 'dynamic';

                const periods = toArray(mpd.Period);
                const period = periods[0] || {};
                const adaptationSets = toArray(period.AdaptationSet);

                const videoQualities = [];
                const audioTracks = [];
                const subtitleTracks = [];

                for (const as of adaptationSets) {
                    const asAttrs = as.$ || {};
                    const contentType = asAttrs.contentType || asAttrs.mimeType || '';
                    const lang = asAttrs.lang || 'default';

                    const representations = toArray(as.Representation);

                    for (const rep of representations) {
                        const ra = rep.$ || {};
                        const id = ra.id || Math.random().toString(36).substr(2, 6);
                        const bandwidth = parseInt(ra.bandwidth || '0');
                        const width = parseInt(ra.width || '0');
                        const height = parseInt(ra.height || '0');
                        const mimeType = ra.mimeType || asAttrs.mimeType || '';
                        const codecs = ra.codecs || asAttrs.codecs || '';

                        // Build segment base URL
                        let segmentUrl = url; // Fallback
                        const baseURLs = toArray(rep.BaseURL);
                        if (baseURLs.length > 0 && baseURLs[0]._) {
                            segmentUrl = resolveUrl(url, baseURLs[0]._);
                        } else if (baseURLs.length > 0 && typeof baseURLs[0] === 'string') {
                            segmentUrl = resolveUrl(url, baseURLs[0]);
                        }

                        const track = {
                            id,
                            bandwidth,
                            mimeType,
                            codecs,
                            url: segmentUrl,
                            manifestUrl: url,
                        };

                        if (contentType.includes('video') || mimeType.includes('video')) {
                            videoQualities.push({
                                ...track,
                                quality: height ? `${height}p` : `${Math.round(bandwidth / 1000)}kbps`,
                                width,
                                height,
                                resolution: width && height ? `${width}x${height}` : null,
                            });
                        } else if (contentType.includes('audio') || mimeType.includes('audio')) {
                            audioTracks.push({
                                ...track,
                                language: lang,
                                label: `${lang} — ${Math.round(bandwidth / 1000)}kbps`,
                                bitrate: `${Math.round(bandwidth / 1000)}kbps`,
                            });
                        } else if (contentType.includes('text') || mimeType.includes('vtt') || mimeType.includes('ttml')) {
                            subtitleTracks.push({
                                id,
                                language: lang,
                                url: segmentUrl,
                            });
                        }
                    }
                }

                // Sort video by height descending
                videoQualities.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
                audioTracks.sort((a, b) => b.bandwidth - a.bandwidth);

                resolve({
                    type: 'dash',
                    duration,
                    isLive,
                    profiles,
                    variants: videoQualities,
                    audio: audioTracks,
                    subtitles: subtitleTracks,
                });

            } catch (e) {
                reject(new Error('DASH parse error: ' + e.message));
            }
        });
    });
}

module.exports = { parseDASH };
