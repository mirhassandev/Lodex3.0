/**
 * Nexus Manager — yt-dlp Wrapper (Phase 6)
 * Extracts rich metadata from any yt-dlp supported URL.
 *
 * Calls: yt-dlp -J --no-playlist <url>
 * Returns structured quality/format/thumbnail information.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

function getYtdlpPath() {
    const fs = require('fs');
    const path = require('path');

    // 1. Try common bundle paths
    const bundlePaths = [
        path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
        path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'),
    ];

    for (const p of bundlePaths) {
        if (fs.existsSync(p)) {
            console.log('[ytdlp-wrapper] Found yt-dlp at:', p);
            return p;
        }
    }

    // 2. Try the module export
    try {
        const ytdlExec = require('youtube-dl-exec');
        if (ytdlExec.path) return ytdlExec.path;
    } catch (e) { }

    // 3. System PATH fallback
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

/**
 * Run yt-dlp -J and parse the JSON output.
 * @param {string} url
 * @param {object} [opts]
 * @param {boolean} [opts.playlist] - Include playlist entries
 * @param {string[]} [opts.extraArgs] - Extra yt-dlp CLI args
 */
function runYtdlpJson(url, opts = {}) {
    return new Promise((resolve, reject) => {
        const ytdlpPath = getYtdlpPath();
        const args = [
            '-J',
            '--no-warnings',
            '--no-check-certificate',
            '--quiet',
            '--no-video-multistreams',
            '--no-playlist',
            '--socket-timeout', '10',
            '--add-header', 'referer:youtube.com',
            '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
        ];

        if (!opts.playlist) {
            args.push('--no-playlist');
        }

        if (opts.extraArgs) {
            args.push(...opts.extraArgs);
        }

        if (opts.headers) {
            Object.entries(opts.headers).forEach(([key, value]) => {
                // Skips if User-Agent or Referer already set above
                if (['referer', 'user-agent'].includes(key.toLowerCase())) return;
                if (value) args.push('--add-header', `${key}:${value}`);
            });
        }

        args.push(url);

        let stdout = '';
        let stderr = '';

        const proc = spawn(ytdlpPath, args, { windowsHide: true });

        proc.stdout.on('data', d => (stdout += d.toString()));
        proc.stderr.on('data', d => (stderr += d.toString()));

        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 300)}`));
            }
            try {
                const data = JSON.parse(stdout);
                resolve(data);
            } catch (e) {
                reject(new Error('yt-dlp returned invalid JSON: ' + e.message));
            }
        });

        proc.on('error', (e) => {
            reject(new Error('Failed to spawn yt-dlp: ' + e.message));
        });

        // Safety timeout
        setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) { }
            reject(new Error('yt-dlp metadata fetch timed out (30s)'));
        }, 30_000);
    });
}

/** Format seconds → MM:SS or HH:MM:SS */
function formatDuration(secs) {
    if (!secs) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.round(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract clean quality list from yt-dlp format array.
 * @param {Array} formats
 * @returns {{ video: Array, audio: Array, combined: Array }}
 */
function parseFormats(formats) {
    if (!formats || !Array.isArray(formats)) return { video: [], audio: [], combined: [] };

    const video = [];
    const audio = [];
    const combined = [];

    for (const f of formats) {
        const hasVideo = f.vcodec && f.vcodec !== 'none';
        const hasAudio = f.acodec && f.acodec !== 'none';
        const height = f.height || 0;
        const ext = f.ext || 'mp4';
        const filesize = f.filesize || f.filesize_approx || 0;
        const tbr = f.tbr || 0;

        const base = {
            formatId: f.format_id,
            ext,
            url: f.url || f.manifest_url || null,
            filesize,
            tbr,
            protocol: f.protocol || 'https',
        };

        if (hasVideo && hasAudio) {
            combined.push({
                ...base,
                type: 'combined',
                quality: height ? `${height}p` : (f.format_note || f.format_id),
                height,
                vcodec: f.vcodec,
                acodec: f.acodec,
                fps: f.fps || null,
                label: height ? `${height}p (${ext.toUpperCase()})` : (f.format_note || 'Video+Audio'),
            });
        } else if (hasVideo) {
            video.push({
                ...base,
                type: 'video-only',
                quality: height ? `${height}p` : (f.format_note || f.format_id),
                height,
                vcodec: f.vcodec,
                fps: f.fps || null,
                label: height ? `${height}p video only (${ext.toUpperCase()})` : (f.format_note || 'Video Only'),
            });
        } else if (hasAudio) {
            const abr = f.abr || Math.round((f.tbr || 0));
            audio.push({
                ...base,
                type: 'audio-only',
                quality: `audio`,
                bitrate: abr ? `${abr}kbps` : 'audio',
                acodec: f.acodec,
                label: abr ? `${abr}kbps HQ (${ext.toUpperCase()})` : `High Quality Audio (${ext.toUpperCase()})`,
            });
        }
    }

    // Sort and Deduplicate Audio
    audio.sort((a, b) => {
        const aBr = parseInt(a.bitrate) || 0;
        const bBr = parseInt(b.bitrate) || 0;
        return bBr - aBr;
    });

    // Add a specialized "Best MP3" option if on YouTube
    if (audio.length > 0) {
        audio.unshift({
            formatId: 'bestaudio',
            ext: 'mp3',
            quality: 'audio',
            type: 'audio-only',
            label: 'Extract as MP3 (Highest Quality)',
            isMP3: true // Flag for downloader
        });
    }

    // Sort by height descending
    combined.sort((a, b) => b.height - a.height);
    video.sort((a, b) => b.height - a.height);
    audio.sort((a, b) => {
        const aBr = parseInt(a.bitrate) || 0;
        const bBr = parseInt(b.bitrate) || 0;
        return bBr - aBr;
    });

    return { video, audio, combined };
}

/**
 * Get full media metadata from a yt-dlp supported URL.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function getMetadata(url, opts = {}) {
    const raw = await runYtdlpJson(url, opts);

    // Check if it's a playlist
    const isPlaylist = raw._type === 'playlist' || (raw.entries && Array.isArray(raw.entries));

    if (isPlaylist) {
        return {
            source: 'youtube-dl',
            isPlaylist: true,
            title: raw.title || raw.id || 'Playlist',
            playlistCount: raw.entries ? raw.entries.length : (raw.playlist_count || 0),
            thumbnail: raw.thumbnail || null,
            uploader: raw.uploader || null,
            entries: (raw.entries || []).map(e => ({
                id: e.id,
                title: e.title,
                url: e.url || e.webpage_url,
                thumbnail: e.thumbnail,
                duration: e.duration,
                durationFormatted: formatDuration(e.duration),
            })),
        };
    }

    const { video, audio, combined } = parseFormats(raw.formats || []);

    // Build the unified quality list for the UI:
    // Prefer combined formats at top, then video-only (for merge)
    const allQualities = [
        ...combined.filter((v, i, a) => a.findIndex(x => x.height === v.height && x.ext === v.ext) === i),
        ...video.filter((v, i, a) => a.findIndex(x => x.height === v.height) === i),
    ].slice(0, 12); // cap at 12 choices

    // Audio-only options
    const audioOnly = audio.slice(0, 5);

    return {
        source: 'youtube-dl',
        isPlaylist: false,
        title: raw.title || raw.id || 'Unknown',
        duration: raw.duration || 0,
        durationFormatted: formatDuration(raw.duration),
        thumbnail: raw.thumbnail || null,
        uploader: raw.uploader || raw.channel || null,
        webpage_url: raw.webpage_url || url,
        description: (raw.description || '').substring(0, 200),
        qualities: allQualities,
        audioFormats: audioOnly,
        subtitles: raw.subtitles || {},
        tags: raw.tags || [],
    };
}

module.exports = { getMetadata, parseFormats, formatDuration, getYtdlpPath };
