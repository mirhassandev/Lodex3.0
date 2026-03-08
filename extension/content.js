// Nexus Manager Content Script - IDM-style Persistent Video Overlay
let overlayDiv = null;
let activeVideo = null;
let overlayDismissed = false;
let trackingLoopId = null;

/**
 * 1. Global Link Interception (LodifyPro Style)
 */
function setupLinkInterception() {
    const fileExtensions = /\.(7z|rar|zip|exe|msi|dmg|pkg|deb|rpm|iso|bin|apk|sh|tar\.gz|tar\.bz2|mp4|mkv|mov|avi|wmv)$/i;

    document.addEventListener('click', (e) => {
        let target = e.target;
        while (target && target !== document) {
            if (target.tagName === 'A' && target.href) {
                const url = target.href;
                if (fileExtensions.test(url)) {
                    e.preventDefault();
                    e.stopPropagation();
                    showToast('Sending link to Nexus Manager...', 'info');
                    sendToNexus(url, target.innerText || 'downloaded_file', false);
                    return false;
                }
            }
            target = target.parentElement;
        }
    }, true);
}

/**
 * 2. Specialized Shorts Detection
 */
function findShortsPlayer() {
    return document.querySelector('ytd-shorts-player') || 
           document.querySelector('ytd-reel-video-player') ||
           document.querySelector('video')?.closest('ytd-shorts-player');
}

/**
 * 3. In-Page Feedback (Toasts)
 */
function showToast(message, type = 'success') {
    const existing = document.getElementById('nexus-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'nexus-toast';
    toast.innerHTML = `<div class="nexus-toast-dot"></div><span>${message}</span>`;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 600);
    }, 4000);
}

/**
 * 4. High-Performance Handshake (Direct Fetch)
 */
function sendToNexus(url, filename, isYouTube = false) {
    const payload = {
        url,
        filename: filename || document.title,
        isYouTube: isYouTube || url.includes('youtube.com') || url.includes('youtu.be'),
        userAgent: navigator.userAgent,
        referrer: window.location.href,
        isInteractive: true,
        source: 'browser-manual'
    };

    fetch('http://127.0.0.1:4578/intercept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(data => { if (data.ok) showToast('Link Captured Successfully!'); })
    .catch(() => {
        chrome.runtime.sendMessage({ type: "DOWNLOAD_VIDEO", ...payload }, (res) => {
            if (res && res.ok) showToast('Link Captured via Relay');
        });
    });
}

/**
 * 5. Persistent Overlay Logic (IDM Style)
 */
function createOverlay() {
    if (document.getElementById('nexus-video-overlay')) return;

    overlayDiv = document.createElement('div');
    overlayDiv.id = 'nexus-video-overlay';

    overlayDiv.innerHTML = `
        <div class="nexus-btn-container">
            <div class="nexus-btn-main" title="Download this video">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>Download</span>
            </div>
            <div class="nexus-close-btn" title="Close for this session">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
        </div>
    `;

    const mainBtn = overlayDiv.querySelector('.nexus-btn-main');
    const closeBtn = overlayDiv.querySelector('.nexus-close-btn');

    mainBtn.onclick = (e) => {
        e.stopPropagation();
        sendToNexus(window.location.href, document.title, true);
    };

    closeBtn.onclick = (e) => {
        e.stopPropagation();
        overlayDismissed = true;
        hideOverlay();
    };

    document.body.appendChild(overlayDiv);
}

function updateOverlayPosition() {
    if (!activeVideo || !overlayDiv || overlayDismissed) return;

    // Mode Awareness: Hide if fullscreen or PiP
    if (document.fullscreenElement || document.pictureInPictureElement) {
        if (overlayDiv.classList.contains('visible')) hideOverlay();
        return;
    }

    const rect = activeVideo.getBoundingClientRect();
    
    // Visibility Check: Ensure video is actually visible and has size
    if (rect.width < 100 || rect.height < 100 || rect.top > window.innerHeight || rect.bottom < 0) {
        if (overlayDiv.classList.contains('visible')) hideOverlay();
        return;
    }

    const isShorts = findShortsPlayer();
    
    // Smooth Positioning
    if (isShorts) {
        overlayDiv.style.top = (window.scrollY + rect.top + 20) + 'px';
        overlayDiv.style.left = (window.scrollX + rect.right - 140) + 'px';
    } else {
        overlayDiv.style.top = (window.scrollY + rect.top + 10) + 'px';
        overlayDiv.style.left = (window.scrollX + rect.right - 130) + 'px';
    }

    if (!overlayDiv.classList.contains('visible')) {
        overlayDiv.style.display = 'flex';
        requestAnimationFrame(() => overlayDiv.classList.add('visible'));
    }
}

function hideOverlay() {
    if (overlayDiv) {
        overlayDiv.classList.remove('visible');
        setTimeout(() => { if (!overlayDiv.classList.contains('visible')) overlayDiv.style.display = 'none'; }, 300);
    }
}

function startTrackingLoop() {
    if (trackingLoopId) return;
    trackingLoopId = setInterval(() => {
        if (overlayDismissed) return;

        // 1. Domain Check: On YouTube, only show for /watch or /shorts
        const isYT = window.location.hostname.includes('youtube.com');
        if (isYT) {
            const pathname = window.location.pathname;
            if (!pathname.includes('/watch') && !pathname.includes('/shorts')) {
                activeVideo = null;
                hideOverlay();
                return;
            }
        }

        // 2. Find the best video element on page
        const videos = Array.from(document.querySelectorAll('video')).filter(v => {
            // Quality Filter: Ignore small ads, thumbnails, or previews
            const rect = v.getBoundingClientRect();
            return v.readyState > 0 && 
                   v.offsetParent !== null && 
                   v.videoWidth >= 300 && 
                   v.videoHeight >= 200 &&
                   rect.width >= 300;
        });
        
        if (videos.length > 0) {
            // Priority: YouTube main player or largest visible video
            let best = videos.find(v => v.classList.contains('html5-main-video')) || videos[0];
            activeVideo = best;
            updateOverlayPosition();
        } else {
            activeVideo = null;
            hideOverlay();
        }
    }, 1000); // 1s detection interval is enough for SPA/navigation
}

// Fullscreen Tracking
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) hideOverlay();
});

// Listen for navigation from background (SPA support)
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "PAGE_NAVIGATED") {
        overlayDismissed = false; // Reset for new video
        activeVideo = null;
        hideOverlay();
    }
});

// Initialization
setupLinkInterception();
createOverlay();
startTrackingLoop();
