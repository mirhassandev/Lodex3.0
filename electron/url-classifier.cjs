/**
 * Nexus Manager — URL Classifier (Phase 5)
 * Classifies any URL and returns structured download metadata.
 *
 * Pipeline order:
 *   1. YouTube host check → ytdl
 *   2. URL file extension check
 *   3. Site preset lookup
 *   4. Stream URL patterns (.m3u8 / .mpd)
 *   5. HEAD request MIME sniff (fallback)
 */

'use strict';

const { findPreset } = require('./site-presets.cjs');
const { headWithRedirect } = require('./request-utils.cjs');

// ─── Extension → Type/MIME map ────────────────────────────────────────────────

const EXT_MAP = {
    // Video
    '.mp4': { type: 'video', mime: 'video/mp4', protocol: 'direct' },
    '.mkv': { type: 'video', mime: 'video/x-matroska', protocol: 'direct' },
    '.webm': { type: 'video', mime: 'video/webm', protocol: 'direct' },
    '.avi': { type: 'video', mime: 'video/x-msvideo', protocol: 'direct' },
    '.mov': { type: 'video', mime: 'video/quicktime', protocol: 'direct' },
    '.flv': { type: 'video', mime: 'video/x-flv', protocol: 'direct' },
    '.wmv': { type: 'video', mime: 'video/x-ms-wmv', protocol: 'direct' },
    '.3gp': { type: 'video', mime: 'video/3gpp', protocol: 'direct' },
    '.asf': { type: 'video', mime: 'video/x-ms-asf', protocol: 'direct' },
    '.m4v': { type: 'video', mime: 'video/x-m4v', protocol: 'direct' },
    '.mpe': { type: 'video', mime: 'video/mpeg', protocol: 'direct' },
    '.mpeg': { type: 'video', mime: 'video/mpeg', protocol: 'direct' },
    '.mpg': { type: 'video', mime: 'video/mpeg', protocol: 'direct' },
    '.ogv': { type: 'video', mime: 'video/ogg', protocol: 'direct' },
    '.qt': { type: 'video', mime: 'video/quicktime', protocol: 'direct' },
    '.rm': { type: 'video', mime: 'application/vnd.rn-realmedia', protocol: 'direct' },
    '.rmvb': { type: 'video', mime: 'application/vnd.rn-realmedia-vbr', protocol: 'direct' },

    // Streams
    '.m3u8': { type: 'stream', mime: 'application/x-mpegURL', protocol: 'hls', isStream: true },
    '.mpd': { type: 'stream', mime: 'application/dash+xml', protocol: 'dash', isStream: true },
    '.ts': { type: 'stream', mime: 'video/mp2t', protocol: 'direct' },

    // Audio
    '.mp3': { type: 'audio', mime: 'audio/mpeg', protocol: 'direct' },
    '.m4a': { type: 'audio', mime: 'audio/mp4', protocol: 'direct' },
    '.flac': { type: 'audio', mime: 'audio/flac', protocol: 'direct' },
    '.wav': { type: 'audio', mime: 'audio/wav', protocol: 'direct' },
    '.ogg': { type: 'audio', mime: 'audio/ogg', protocol: 'direct' },
    '.aac': { type: 'audio', mime: 'audio/aac', protocol: 'direct' },
    '.aif': { type: 'audio', mime: 'audio/x-aiff', protocol: 'direct' },
    '.mpa': { type: 'audio', mime: 'audio/mpeg', protocol: 'direct' },
    '.ra': { type: 'audio', mime: 'audio/x-pn-realaudio', protocol: 'direct' },
    '.wma': { type: 'audio', mime: 'audio/x-ms-wma', protocol: 'direct' },

    // Documents
    '.pdf': { type: 'document', mime: 'application/pdf', protocol: 'direct' },
    '.doc': { type: 'document', mime: 'application/msword', protocol: 'direct' },
    '.docx': { type: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', protocol: 'direct' },
    '.xls': { type: 'document', mime: 'application/vnd.ms-excel', protocol: 'direct' },
    '.xlsx': { type: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', protocol: 'direct' },
    '.ppt': { type: 'document', mime: 'application/vnd.ms-powerpoint', protocol: 'direct' },
    '.pps': { type: 'document', mime: 'application/vnd.ms-powerpoint', protocol: 'direct' },
    '.txt': { type: 'document', mime: 'text/plain', protocol: 'direct' },

    // Images
    '.jpg': { type: 'image', mime: 'image/jpeg', protocol: 'direct' },
    '.jpeg': { type: 'image', mime: 'image/jpeg', protocol: 'direct' },
    '.png': { type: 'image', mime: 'image/png', protocol: 'direct' },
    '.gif': { type: 'image', mime: 'image/gif', protocol: 'direct' },
    '.webp': { type: 'image', mime: 'image/webp', protocol: 'direct' },
    '.svg': { type: 'image', mime: 'image/svg+xml', protocol: 'direct' },
    '.tif': { type: 'image', mime: 'image/tiff', protocol: 'direct' },
    '.tiff': { type: 'image', mime: 'image/tiff', protocol: 'direct' },

    // Archives
    '.zip': { type: 'archive', mime: 'application/zip', protocol: 'direct' },
    '.rar': { type: 'archive', mime: 'application/x-rar-compressed', protocol: 'direct' },
    '.7z': { type: 'archive', mime: 'application/x-7z-compressed', protocol: 'direct' },
    '.tar': { type: 'archive', mime: 'application/x-tar', protocol: 'direct' },
    '.gz': { type: 'archive', mime: 'application/gzip', protocol: 'direct' },
    '.gzip': { type: 'archive', mime: 'application/gzip', protocol: 'direct' },
    '.ace': { type: 'archive', mime: 'application/x-ace-compressed', protocol: 'direct' },
    '.arj': { type: 'archive', mime: 'application/x-arj', protocol: 'direct' },
    '.bz2': { type: 'archive', mime: 'application/x-bzip2', protocol: 'direct' },
    '.lzh': { type: 'archive', mime: 'application/x-lzh', protocol: 'direct' },
    '.r00': { type: 'archive', mime: 'application/x-rar-compressed', protocol: 'direct' },
    '.r01': { type: 'archive', mime: 'application/x-rar-compressed', protocol: 'direct' },
    '.r02': { type: 'archive', mime: 'application/x-rar-compressed', protocol: 'direct' },
    '.r10': { type: 'archive', mime: 'application/x-rar-compressed', protocol: 'direct' },
    '.sea': { type: 'archive', mime: 'application/x-sea', protocol: 'direct' },
    '.sit': { type: 'archive', mime: 'application/x-stuffit', protocol: 'direct' },
    '.sitx': { type: 'archive', mime: 'application/x-stuffitx', protocol: 'direct' },
    '.z': { type: 'archive', mime: 'application/x-compress', protocol: 'direct' },

    // Software & Disk Images
    '.exe': { type: 'program', mime: 'application/x-msdownload', protocol: 'direct' },
    '.dmg': { type: 'program', mime: 'application/x-apple-diskimage', protocol: 'direct' },
    '.apk': { type: 'program', mime: 'application/vnd.android.package-archive', protocol: 'direct' },
    '.iso': { type: 'program', mime: 'application/x-iso9660-image', protocol: 'direct' },
    '.img': { type: 'program', mime: 'application/x-img', protocol: 'direct' },
    '.deb': { type: 'program', mime: 'application/x-debian-package', protocol: 'direct' },
    '.msi': { type: 'program', mime: 'application/x-msi', protocol: 'direct' },
    '.msu': { type: 'program', mime: 'application/vnd.ms-cab-compressed', protocol: 'direct' },
    '.bin': { type: 'program', mime: 'application/octet-stream', protocol: 'direct' },
    '.plj': { type: 'program', mime: 'application/octet-stream', protocol: 'direct' },
};

// ─── MIME → type/ext fallback map ─────────────────────────────────────────────

const MIME_TYPE_MAP = {
    'video/mp4': { type: 'video', ext: '.mp4' },
    'video/webm': { type: 'video', ext: '.webm' },
    'video/x-matroska': { type: 'video', ext: '.mkv' },
    'video/x-msvideo': { type: 'video', ext: '.avi' },
    'video/quicktime': { type: 'video', ext: '.mov' },
    'video/ogg': { type: 'video', ext: '.ogg' },
    'video/mp2t': { type: 'video', ext: '.ts' },
    'audio/mpeg': { type: 'audio', ext: '.mp3' },
    'audio/mp4': { type: 'audio', ext: '.m4a' },
    'audio/flac': { type: 'audio', ext: '.flac' },
    'audio/ogg': { type: 'audio', ext: '.ogg' },
    'audio/wav': { type: 'audio', ext: '.wav' },
    'audio/aac': { type: 'audio', ext: '.aac' },
    'application/pdf': { type: 'document', ext: '.pdf' },
    'application/zip': { type: 'archive', ext: '.zip' },
    'application/x-rar-compressed': { type: 'archive', ext: '.rar' },
    'application/gzip': { type: 'archive', ext: '.gz' },
    'application/x-7z-compressed': { type: 'archive', ext: '.7z' },
    'application/x-msdownload': { type: 'program', ext: '.exe' },
    'application/vnd.android.package-archive': { type: 'program', ext: '.apk' },
    'application/x-iso9660-image': { type: 'program', ext: '.iso' },
    'application/x-mpegURL': { type: 'stream', ext: '.m3u8', protocol: 'hls', isStream: true },
    'application/vnd.apple.mpegurl': { type: 'stream', ext: '.m3u8', protocol: 'hls', isStream: true },
    'application/dash+xml': { type: 'stream', ext: '.mpd', protocol: 'dash', isStream: true },
    'image/jpeg': { type: 'image', ext: '.jpg' },
    'image/png': { type: 'image', ext: '.png' },
    'image/gif': { type: 'image', ext: '.gif' },
    'image/webp': { type: 'image', ext: '.webp' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Perform a HEAD request to sniff MIME + Content-Length + Redirects.
 */
async function headRequest(url, extraHeaders = {}) {
    try {
        return await headWithRedirect(url, extraHeaders);
    } catch (e) {
        console.warn('[Classifier] HEAD failed:', e.message);
        return { mime: '', size: 0, disposition: '', statusCode: 0, finalUrl: url };
    }
}

/**
 * Resolve a human-readable filename from a URL and optional headers.
 * Priority: content-disposition > URL path basename > host_timestamp
 */
function resolveFilename(url, headInfo = {}, ext = '') {
    // 1. From Content-Disposition header
    if (headInfo.disposition) {
        const match = headInfo.disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
        if (match) {
            try {
                return decodeURIComponent(match[1].trim().replace(/['"]/g, ''));
            } catch { /* ignore */ }
        }
    }

    // 2. From URL path
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        // Get the last segment, strip query params
        let base = pathname.split('/').filter(Boolean).pop() || '';
        if (base) {
            base = decodeURIComponent(base); // Decode %20 etc.
            // If it has no extension and we know one, add it
            if (ext && !base.includes('.')) base += ext;
            if (base.length > 1) return sanitizeFilename(base);
        }

        // 3. Fallback: host + timestamp
        const hostname = parsed.hostname.replace('www.', '');
        return sanitizeFilename(`${hostname}_${Date.now()}${ext}`);
    } catch (e) {
        return `nexus_download_${Date.now()}${ext}`;
    }
}

/**
 * Strip illegal filename characters.
 */
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 200);
}

// ─── Main Classifier ──────────────────────────────────────────────────────────

/**
 * Classify a URL and return structured download metadata.
 *
 * @param {string} url
 * @param {object} [headers] - Optional extra request headers (e.g. Cookie, Referer)
 * @returns {Promise<object>}
 */
async function classify(url, headers = {}) {
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Classification timeout')), 5000);
    });

    try {
        return await Promise.race([
            _classifyInternal(url, headers),
            timeoutPromise
        ]);
    } catch (e) {
        console.warn(`[Classifier] Classification failed or timed out for ${url}:`, e.message);
        return {
            type: 'document',
            protocol: 'direct',
            mime: '',
            ext: '',
            filename: '',
            size: 0,
            isStream: false,
            requiresYtdl: false,
        };
    }
}

async function _classifyInternal(url, headers = {}) {
    let result = {
        type: 'document',
        protocol: 'direct',
        mime: '',
        ext: '',
        filename: '',
        size: 0,
        site: null,
        isStream: false,
        requiresYtdl: false,
    };

    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        result.filename = `invalid_url_${Date.now()}`;
        return result;
    }

    const hostname = parsed.hostname.toLowerCase();
    // URL path without query
    const pathOnly = parsed.pathname.toLowerCase();
    // Extract extension from path
    const pathExt = pathOnly.match(/(\.[a-z0-9]{2,6})(?:\?|$)/)?.[1] || '';

    // ── STEP 1: YouTube fast-path ──────────────────────────────────────────────
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        result.type = 'youtube';
        result.protocol = 'ytdl';
        result.requiresYtdl = true;
        result.ext = '.mp4';
        result.mime = 'video/mp4';
        result.site = 'youtube';
        result.filename = resolveFilename(url, {}, '.mp4');
        return result;
    }

    // GoogleVideo / YouTube fragments - don't perform HEAD, it's slow/unreliable
    if (hostname.includes('googlevideo.com')) {
        result.type = 'video';
        result.protocol = 'direct';
        result.ext = '.mp4';
        result.filename = resolveFilename(url, {}, '.mp4');
        return result;
    }

    // ── STEP 2: URL extension check ────────────────────────────────────────────
    if (pathExt && EXT_MAP[pathExt]) {
        const extInfo = EXT_MAP[pathExt];
        Object.assign(result, extInfo);
        result.ext = pathExt;
        result.filename = resolveFilename(url, {}, pathExt);
        // If already a stream we can return early (no HEAD needed for streams)
        if (result.isStream) return result;
    }

    // ── STEP 3: Site Preset lookup ─────────────────────────────────────────────
    const preset = findPreset(hostname);
    if (preset) {
        result.site = preset.name;
        result.protocol = preset.protocol;
        result.type = preset.type;
        result.requiresYtdl = preset.requiresYtdl || false;
        if (preset.ext) result.ext = preset.ext;
        result.filename = resolveFilename(url, {}, result.ext || '.mp4');
        // ytdl presets don't need HEAD — return early
        if (result.requiresYtdl) return result;
    }

    // ── STEP 4: Stream URL pattern detection ──────────────────────────────────
    const lcUrl = url.toLowerCase();
    if (lcUrl.includes('.m3u8') || lcUrl.includes('m3u8?') ||
        lcUrl.includes('application/x-mpegurl')) {
        result.type = 'stream';
        result.protocol = 'hls';
        result.isStream = true;
        result.ext = '.mp4'; // Output will be mp4 after merge
        result.mime = 'application/x-mpegURL';
        result.filename = resolveFilename(url, {}, '.mp4');
        return result;
    }
    if (lcUrl.includes('.mpd') || lcUrl.includes('mpd?') ||
        lcUrl.includes('application/dash+xml')) {
        result.type = 'stream';
        result.protocol = 'dash';
        result.isStream = true;
        result.ext = '.mp4';
        result.mime = 'application/dash+xml';
        result.filename = resolveFilename(url, {}, '.mp4');
        return result;
    }

    // ── STEP 5: HEAD request MIME sniff (fallback for unknown URLs) ────────────
    const headInfo = await headRequest(url, headers);
    if (headInfo.mime) {
        result.mime = headInfo.mime;
        result.size = headInfo.size;

        // Normalise mime — strip charset/params
        const baseMime = headInfo.mime.split(';')[0].trim();

        if (MIME_TYPE_MAP[baseMime]) {
            const mimeData = MIME_TYPE_MAP[baseMime];
            result.type = mimeData.type;
            result.ext = mimeData.ext || result.ext;
            if (mimeData.protocol) result.protocol = mimeData.protocol;
            if (mimeData.isStream) result.isStream = true;
        } else if (baseMime.startsWith('video/')) {
            result.type = 'video';
        } else if (baseMime.startsWith('audio/')) {
            result.type = 'audio';
        } else if (baseMime.startsWith('image/')) {
            result.type = 'image';
        } else if (baseMime.startsWith('text/')) {
            result.type = 'document';
        }
    }

    // Resolve filename (now we may have a better ext from MIME)
    if (!result.filename) {
        result.filename = resolveFilename(url, headInfo, result.ext);
    } else if (result.size > 0) {
        // Re-resolve with content-disposition in case HEAD provided it
        const betterName = resolveFilename(headInfo.finalUrl || url, headInfo, result.ext);
        if (betterName !== result.filename) result.filename = betterName;
    }

    // Ensure we always have a filename
    if (!result.filename) {
        result.filename = resolveFilename(url, {}, result.ext || '');
    }

    return result;
}

module.exports = { classify, resolveFilename, sanitizeFilename, headRequest };
