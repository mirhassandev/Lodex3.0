/**
 * Nexus Manager — Media Analyzer (Phase 6)
 * Orchestrates HLS, DASH, and yt-dlp parsers to return unified quality metadata.
 *
 * Usage:  const { analyzeMedia } = require('./media-analyzer.cjs');
 *         const result = await analyzeMedia(url, classification);
 */

'use strict';

const { parseHLS } = require('./parsers/hls-parser.cjs');
const { parseDASH } = require('./parsers/dash-parser.cjs');
const { getMetadata } = require('./ytdlp-wrapper.cjs');
const { classify } = require('./url-classifier.cjs');

/**
 * Determine the best analysis strategy and return structured media info.
 *
 * @param {string} url - The media or page URL
 * @param {object} [classification] - Pre-computed classify() result (optional, avoids double HEAD)
 * @param {object} [headers] - Optional request headers
 * @returns {Promise<MediaAnalysis>}
 */
async function analyzeMedia(url, classification = null, headers = {}) {
    // Use existing classification if provided, otherwise run it now
    const meta = classification && classification.type
        ? classification
        : await classify(url, headers);

    // Use normalized URL if provided by classifier
    const targetUrl = meta.url || url;

    // ── YouTube / social media — delegate to yt-dlp ───────────────────────────
    if (meta.requiresYtdl || meta.protocol === 'ytdl' || meta.isYouTube) {
        try {
            const data = await getMetadata(targetUrl, { headers });

            if (data.isPlaylist) {
                return {
                    source: 'ytdl',
                    title: data.title,
                    isPlaylist: true,
                    isYouTube: true,
                    playlistCount: data.playlistCount,
                    thumbnail: data.thumbnail,
                    uploader: data.uploader,
                    duration: 0,
                    durationFormatted: '',
                    qualities: [],
                    audio: [],
                    subtitles: [],
                    entries: data.entries,
                };
            }

            return {
                source: 'ytdl',
                title: data.title,
                isPlaylist: false,
                thumbnail: data.thumbnail,
                uploader: data.uploader,
                isYouTube: true,
                duration: data.duration,
                durationFormatted: data.durationFormatted,
                webpage_url: data.webpage_url,
                qualities: data.qualities,
                audio: data.audioFormats,
                subtitles: data.subtitles,
                description: data.description,
            };
        } catch (e) {
            console.error('[MediaAnalyzer] yt-dlp metadata fetch failed critically:', e.message);
            // Graceful degradation — return minimal info with error
            return _fallbackResult(url, meta, `yt-dlp error: ${e.message}`);
        }
    }

    // ── HLS stream ─────────────────────────────────────────────────────────────
    if (meta.protocol === 'hls' || meta.isStream && targetUrl.toLowerCase().includes('m3u8')) {
        try {
            const data = await parseHLS(targetUrl, headers);
 
            return {
                source: 'hls',
                title: _titleFromUrl(targetUrl),
                isPlaylist: false,
                thumbnail: null,
                uploader: null,
                duration: data.duration || 0,
                durationFormatted: _formatDuration(data.duration || 0),
                isLive: data.isLive,
                qualities: data.variants.map(v => ({
                    ...v,
                    type: 'hls-variant',
                    label: v.quality,
                    formatId: v.quality,
                })),
                audio: [],
                subtitles: data.subtitles || [],
            };
        } catch (e) {
            console.error('[MediaAnalyzer] HLS parse failed:', e.message);
            return _fallbackResult(targetUrl, meta, e.message);
        }
    }
 
    // ── DASH stream ────────────────────────────────────────────────────────────
    if (meta.protocol === 'dash' || meta.isStream && targetUrl.toLowerCase().includes('.mpd')) {
        try {
            const data = await parseDASH(targetUrl, headers);
 
            return {
                source: 'dash',
                title: _titleFromUrl(targetUrl),
                isPlaylist: false,
                thumbnail: null,
                uploader: null,
                duration: data.duration || 0,
                durationFormatted: _formatDuration(data.duration || 0),
                isLive: data.isLive,
                qualities: data.variants.map(v => ({
                    ...v,
                    type: 'dash-video',
                    label: v.quality,
                    formatId: v.id,
                })),
                audio: data.audio.map(a => ({
                    ...a,
                    type: 'dash-audio',
                    label: a.label,
                    formatId: a.id,
                })),
                subtitles: data.subtitles || [],
            };
        } catch (e) {
            console.error('[MediaAnalyzer] DASH parse failed:', e.message);
            return _fallbackResult(targetUrl, meta, e.message);
        }
    }

    // ── Direct file — return single quality option ─────────────────────────────
    return {
        source: 'direct',
        title: meta.filename || _titleFromUrl(targetUrl),
        isPlaylist: false,
        thumbnail: null,
        uploader: null,
        duration: 0,
        durationFormatted: '',
        qualities: [{
            type: 'direct',
            quality: 'Original',
            label: `Direct File (${meta.ext || ''})`,
            url: targetUrl,
            filesize: meta.size || 0,
            formatId: 'direct',
            ext: meta.ext,
        }],
        audio: [],
        subtitles: [],
    };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _titleFromUrl(url) {
    try {
        const u = new URL(url);
        const seg = u.pathname.split('/').filter(Boolean).pop() || '';
        return decodeURIComponent(seg).replace(/\.[^.]+$/, '') || u.hostname;
    } catch {
        return 'Media';
    }
}

function _formatDuration(secs) {
    if (!secs) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.round(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function _fallbackResult(url, meta, errorMsg) {
    const targetUrl = meta.url || url;
    return {
        source: 'fallback',
        title: meta.filename || _titleFromUrl(targetUrl),
        error: errorMsg,
        isPlaylist: false,
        thumbnail: null,
        uploader: null,
        duration: 0,
        durationFormatted: '',
        qualities: [{
            type: 'direct',
            quality: 'Original',
            label: 'Direct Download',
            url: targetUrl,
            filesize: meta.size || 0,
            formatId: 'direct',
        }],
        audio: [],
        subtitles: [],
    };
}

module.exports = { analyzeMedia };
