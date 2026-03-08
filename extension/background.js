// Nexus Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        interceptEnabled: true,
        autoCapture: false,
        streams: [] // Will store detected media streams
    });
});

// 1. Download Intercept Filter
const INTERCEPT_EXTENSIONS = [
    ".exe", ".msi", ".zip", ".rar", ".7z",
    ".iso", ".tar", ".dmg", ".bin", ".mkv", ".mp4"
];

// 2. Main Interceptor
chrome.downloads.onCreated.addListener(async (item) => {
    const { interceptEnabled } = await chrome.storage.local.get("interceptEnabled");
    if (!interceptEnabled || item.state !== "in_progress") return;

    // Check if URL matches targeted file types
    const url = item.url.toLowerCase().split('?')[0];
    const isTarget = INTERCEPT_EXTENSIONS.some(ext => url.endsWith(ext));
    if (!isTarget) return;

    // Don't intercept localhost or local file downloads
    if (item.url.startsWith("http://127.0.0.1") || item.url.startsWith("http://localhost") || item.url.startsWith("file://")) return;

    // Pause immediately to prevent browser from starting the data stream
    chrome.downloads.pause(item.id);

    // Get cookies for the domain to ensure authenticated downloads work in Nexus
    chrome.cookies.getAll({ url: item.url }, async (cookies) => {
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        try {
            const payload = {
                url: item.url,
                filename: item.filename,
                size: item.fileSize,
                mimeType: item.mime,
                referrer: item.referrer || "",
                userAgent: navigator.userAgent,
                cookies: cookieString,
                source: "browser-interception"
            };

            // Bridge to Nexus Desktop on dedicated port 4578
            const response = await fetch("http://127.0.0.1:4578/intercept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                // Successfully handed off to Nexus, cancel browser download
                chrome.downloads.cancel(item.id);

                // Show a simple notification to the user
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: 'Nexus Manager',
                    message: 'Download intercepted and sent to Nexus.'
                });
            } else {
                chrome.downloads.resume(item.id);
            }
        } catch (e) {
            console.error("[Nexus] Intercept failed (Nexus might be offline):", e);
            chrome.downloads.resume(item.id);
        }
    });
});

// 7. Advanced Media Sniffer & Header Capture
const MEDIA_EXTENSIONS = ['.mp4', '.m3u8', '.mpd', '.webm', '.ts', '.m4s', '.flv', '.aac', '.mp3', '.m4a'];
const STREAM_EXTENSIONS = ['.m3u8', '.mpd'];
const STREAM_PATTERNS = [
    'm3u8?', 'mpd?', 'playlist', 'manifest', 'chunklist',
    'videoplayback', 'googlevideo.com', 'mime=video', 'mime=audio'
];
const MEDIA_MIMES = [
    'video/mp4', 'video/webm', 'video/ogg', 'video/mpeg',
    'application/x-mpegURL', 'application/vnd.apple.mpegurl',
    'application/dash+xml', 'video/MP2T', 'video/iso.segment',
    'audio/mpeg', 'audio/webm', 'audio/aac', 'audio/mp4'
];

// Memory cache for headers per URL to avoid redundant reporting
const headerCache = new Map();
const reportedMedia = new Set();
// tabId -> Set of detected base URLs (for deduplication)
const detectedInTab = new Map();

// A. Capture Request Headers (Auth, Cookies, Referrer)
chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        if (details.url.includes("127.0.0.1") || details.url.includes("localhost")) return;

        const headers = {};
        const importantHeaders = ['cookie', 'authorization', 'referer', 'user-agent', 'origin'];

        details.requestHeaders.forEach(h => {
            if (importantHeaders.includes(h.name.toLowerCase())) {
                headers[h.name.toLowerCase()] = h.value;
            }
        });

        // Store in cache for this URL
        headerCache.set(details.url, {
            headers,
            timestamp: Date.now()
        });

        // Optional: Proactively report if it's a known media extension
        if (MEDIA_EXTENSIONS.some(ext => details.url.toLowerCase().split('?')[0].endsWith(ext))) {
            reportHeaders(details.url, headers);
        }
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
);

async function reportHeaders(url, headers) {
    try {
        await fetch("http://127.0.0.1:4578/capture-headers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, headers })
        });
    } catch (e) { /* Nexus offline */ }
}

// B. Sniff Response for Media/Streams
chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
        if (details.url.includes("127.0.0.1:5000") || details.url.includes("127.0.0.1:4578")) return;

        let isMedia = false;
        let mimeType = '';
        const lcUrl = details.url.toLowerCase();

        // 1. Check extension
        if (MEDIA_EXTENSIONS.some(ext => lcUrl.split('?')[0].endsWith(ext))) isMedia = true;

        // 2. Check content-type
        if (details.responseHeaders) {
            const ct = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
            if (ct) {
                mimeType = ct.value || '';
                if (MEDIA_MIMES.some(m => mimeType.toLowerCase().includes(m.toLowerCase()))) {
                    isMedia = true;
                }
            }
        }

        // 3. Check patterns
        if (!isMedia && STREAM_PATTERNS.some(p => lcUrl.includes(p))) isMedia = true;

        // Don't report YouTube technical fragments as separate streams
        if (lcUrl.includes('googlevideo.com') || lcUrl.includes('videoplayback')) {
            isMedia = false;
        }

        // 4. Advanced Production Filtering (IDM Style)
        const fragments = ['&range=', '&index=', 'sq/', '/v1/player/heartbeat', 'ptracking', 'log_event'];
        if (fragments.some(p => lcUrl.includes(p))) isMedia = false;

        // 5. Size & Type verification
        if (isMedia && details.responseHeaders) {
            const ct = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-type');
            const cl = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-length');
            
            const contentType = ct ? ct.value.toLowerCase() : '';
            mimeType = contentType;
            const contentLength = cl ? parseInt(cl.value) : 0;

            // Only allow if it's a manifest (small) or a real media file (> 2MB)
            const isManifest = STREAM_EXTENSIONS.some(ext => lcUrl.split('?')[0].endsWith(ext)) || 
                               contentType.includes('mpegurl') || contentType.includes('dash+xml');
            
            if (!isManifest && contentLength > 0 && contentLength < 2 * 1024 * 1024) {
               isMedia = false;
            }

            if (isMedia && !isManifest && !contentType.includes('video') && !contentType.includes('audio') && !lcUrl.includes('mpeg')) {
                // Secondary check: if not manifest and not clearly media, skip
                isMedia = false;
            }
        }

        if (isMedia) {
            const isStream = STREAM_EXTENSIONS.some(ext => lcUrl.split('?')[0].endsWith(ext))
                || STREAM_PATTERNS.some(p => lcUrl.includes(p))
                || mimeType.includes('mpegURL') || mimeType.includes('dash+xml');

            let quality = "Unknown";
            if (lcUrl.includes("1080")) quality = "1080p";
            else if (lcUrl.includes("720")) quality = "720p";
            else if (lcUrl.includes("480")) quality = "480p";

            const cached = headerCache.get(details.url);

            const mediaData = {
                url: details.url,
                mimeType,
                quality,
                isStream,
                headers: cached ? cached.headers : {},
                tabId: details.tabId,
                timestamp: Date.now()
            };

            // Notify content script in the tab
            if (details.tabId > 0) {
                chrome.tabs.sendMessage(details.tabId, { type: "MEDIA_DETECTED", media: mediaData }).catch(() => { });
            }

            // Sync to local storage for the popup (with deduplication)
            chrome.storage.local.get("streams", ({ streams }) => {
                let list = streams || [];
                const baseUrl = details.url.split('?')[0];
                const idx = list.findIndex(s => s.url.split('?')[0] === baseUrl);

                if (idx > -1) list[idx] = mediaData;
                else list.push(mediaData);

                if (list.length > 30) list = list.slice(-30);
                chrome.storage.local.set({ streams: list });
            });

            // Proactively report to Nexus (Deduplicated)
            const baseUrl = details.url.split('?')[0];

            // Per-tab deduplication
            if (!detectedInTab.has(details.tabId)) detectedInTab.set(details.tabId, new Set());
            const tabSet = detectedInTab.get(details.tabId);

            if (!tabSet.has(baseUrl)) {
                tabSet.add(baseUrl);
                reportedMedia.add(baseUrl);
                fetch("http://127.0.0.1:4578/media-detected", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(mediaData)
                }).catch(() => { });

                // Keep set small
                if (reportedMedia.size > 200) reportedMedia.clear();
            }
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders", "extraHeaders"]
);

// Cleanup header cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [url, data] of headerCache.entries()) {
        if (now - data.timestamp > 300000) headerCache.delete(url); // 5 min expiry
    }
}, 60000);

// 9. SPA Navigation Support
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        // Normal navigation OR SPA history change (YouTube/Twitter)
        console.log(`[Nexus] Navigated to ${changeInfo.url}, clearing tab ${tabId} streams`);
        
        detectedInTab.delete(tabId);
        
        // Clear local storage streams for this tab or entirely if desired
        chrome.storage.local.get("streams", ({ streams }) => {
            if (streams) {
                const filtered = streams.filter(s => s.tabId !== tabId);
                chrome.storage.local.set({ streams: filtered });
            }
        });

        // Notify content script to reset UI
        chrome.tabs.sendMessage(tabId, { type: "PAGE_NAVIGATED", url: changeInfo.url }).catch(() => {});
    }
});

// 10. Message Handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "DOWNLOAD_VIDEO") {
        const url = msg.url || '';
        const cached = headerCache.get(url);

        const payload = {
            url,
            filename: msg.filename || "video.mp4",
            headers: (cached && cached.headers) ? cached.headers : (msg.headers || {}),
            quality: msg.isInteractive ? "Select Quality..." : (msg.quality || "Unknown"),
            type: msg.isStream ? "stream" : "file",
            isYouTube: !!msg.isYouTube,
            isAudioOnly: !!msg.isAudioOnly,
            source: msg.isInteractive ? "browser-manual" : "browser-overlay"
        };

        fetch("http://127.0.0.1:4578/intercept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
            .then(res => res.json())
            .then(data => sendResponse({ ok: true, data }))
            .catch(err => sendResponse({ ok: false, error: err.message }));

        return true;
    }
});
