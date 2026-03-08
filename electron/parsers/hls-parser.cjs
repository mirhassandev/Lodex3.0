/**
 * Nexus Manager — HLS Playlist Parser (Phase 6)
 * Parses both master playlists (quality variants) and media playlists (segments).
 * Uses simple text parsing — no external dependencies required.
 */

'use strict';

const https = require('https');
const http = require('http');

function fetchText(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('HLS fetch timeout')); });
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

/**
 * Parse a master HLS playlist into quality variants.
 * @param {string} text - Raw playlist text
 * @param {string} baseUrl - Base URL to resolve relative paths
 * @returns {Array} Sorted quality variants
 */
function parseMasterPlaylist(text, baseUrl) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#EXT-X-STREAM-INF')) continue;

        // Parse attributes
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const codecsMatch = line.match(/CODECS="([^"]+)"/);
        const nameMatch = line.match(/NAME="([^"]+)"/);

        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
        const resolution = resolutionMatch ? resolutionMatch[1] : null;
        const height = resolution ? parseInt(resolution.split('x')[1]) : 0;
        const qualityLabel = nameMatch ? nameMatch[1]
            : (height ? `${height}p` : `${Math.round(bandwidth / 1000)}kbps`);

        // Next non-comment line is the media playlist URI
        const nextLine = lines[i + 1];
        if (!nextLine || nextLine.startsWith('#')) continue;

        variants.push({
            quality: qualityLabel,
            height,
            bandwidth,
            resolution: resolution || `${Math.round(bandwidth / 1000)}kbps`,
            codecs: codecsMatch ? codecsMatch[1] : null,
            url: resolveUrl(baseUrl, nextLine),
        });
    }

    return variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

/**
 * Parse a media HLS playlist to get segment list.
 * @param {string} text
 * @param {string} baseUrl
 * @returns {{ segments, duration, isLive, hasEncryption }}
 */
function parseMediaPlaylist(text, baseUrl) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const segments = [];
    let totalDuration = 0;
    let currentDuration = 0;
    let currentKey = null;
    let isLive = true;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line === '#EXT-X-ENDLIST') {
            isLive = false;
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            currentDuration = parseFloat(line.replace('#EXTINF:', '').split(',')[0]) || 0;
            continue;
        }

        if (line.startsWith('#EXT-X-KEY:')) {
            const methodMatch = line.match(/METHOD=([^,]+)/);
            const uriMatch = line.match(/URI="([^"]+)"/);
            const ivMatch = line.match(/IV=([^,\s]+)/);
            currentKey = {
                method: methodMatch ? methodMatch[1] : 'NONE',
                uri: uriMatch ? resolveUrl(baseUrl, uriMatch[1]) : null,
                iv: ivMatch ? ivMatch[1] : null,
            };
            continue;
        }

        if (!line.startsWith('#') && currentDuration > 0) {
            segments.push({
                index: segments.length,
                url: resolveUrl(baseUrl, line),
                duration: currentDuration,
                key: currentKey,
            });
            totalDuration += currentDuration;
            currentDuration = 0;
        }
    }

    return {
        segments,
        duration: totalDuration,
        isLive,
        hasEncryption: segments.some(s => s.key && s.key.method !== 'NONE'),
    };
}

/**
 * Main HLS analysis entry point.
 * Auto-detects master vs. media playlist and returns quality variants.
 * @param {string} url
 * @param {object} headers
 * @returns {Promise<object>}
 */
async function parseHLS(url, headers = {}) {
    const text = await fetchText(url, headers);

    // Detect playlist type
    const isMaster = text.includes('#EXT-X-STREAM-INF');

    if (isMaster) {
        const variants = parseMasterPlaylist(text, url);
        // Also check for subtitles
        const subtitleMatches = [...text.matchAll(/#EXT-X-MEDIA:TYPE=SUBTITLES,[^\n]+LANGUAGE="([^"]+)"[^\n]+URI="([^"]+)"/g)];
        const subtitles = subtitleMatches.map(m => ({
            language: m[1],
            url: resolveUrl(url, m[2]),
        }));

        return {
            type: 'master',
            variants,
            subtitles,
            isLive: false,
            raw: text,
        };
    } else {
        const mediaInfo = parseMediaPlaylist(text, url);
        return {
            type: 'media',
            variants: [{
                quality: 'Default',
                height: 0,
                bandwidth: 0,
                url,
                segments: mediaInfo.segments,
            }],
            ...mediaInfo,
        };
    }
}

module.exports = { parseHLS, parseMasterPlaylist, parseMediaPlaylist };
