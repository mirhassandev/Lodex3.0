const statusEl = document.getElementById("status");
const interceptToggle = document.getElementById("interceptToggle");
const autoCaptureToggle = document.getElementById("autoCaptureToggle");
const streamsContainer = document.getElementById("streamsContainer");
const refreshBtn = document.getElementById("refreshStreams");

function checkConnection() {
    fetch("http://127.0.0.1:5000/api/ping")
        .then(r => {
            if (r.ok) {
                statusEl.className = "status online";
                statusEl.innerText = "🟢 Nexus Running";
            } else throw new Error("not ok");
        })
        .catch(() => {
            statusEl.className = "status offline";
            statusEl.innerText = "🔴 Nexus Offline";
        });
}

function loadSettings() {
    chrome.storage.local.get(["interceptEnabled", "autoCapture"], (res) => {
        interceptToggle.checked = res.interceptEnabled !== false;
        autoCaptureToggle.checked = !!res.autoCapture;
    });
}

function loadStreams() {
    chrome.storage.local.get("streams", (res) => {
        const list = res.streams || [];
        if (list.length === 0) {
            streamsContainer.innerHTML = "<div style='opacity: 0.5; text-align: center; padding: 10px 0;'>No active media streams found</div>";
            return;
        }

        streamsContainer.innerHTML = "";
        // Show newest first
        list.slice().reverse().slice(0, 6).forEach(s => {
            const div = document.createElement("div");
            div.className = "stream-item";

            const urlSpan = document.createElement("span");
            urlSpan.className = "stream-url";
            urlSpan.title = s.url;
            // Truncate from beginning if too long, showing the end (extension/file)
            urlSpan.innerText = s.url;

            const qualitySpan = document.createElement("span");
            qualitySpan.innerText = s.quality || "NA";
            qualitySpan.style.color = s.quality !== "Unknown" ? "#60a5fa" : "#6b7280";
            qualitySpan.style.fontSize = "10px";
            qualitySpan.style.marginRight = "auto";
            qualitySpan.style.marginLeft = "6px";

            const dlBtn = document.createElement("button");
            dlBtn.innerText = "⬇";
            dlBtn.title = "Send to Nexus";
            dlBtn.onclick = () => {
                const originalText = dlBtn.innerText;
                dlBtn.innerText = "⏳";
                fetch("http://127.0.0.1:5000/api/browser/download", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url: s.url,
                        filename: "sniffed_media_" + Date.now() + (s.url.includes('.m3u8') ? '.m3u8' : '.mp4'),
                        source: "sniffer",
                        mimeType: s.mimeType,
                        quality: s.quality
                    })
                }).then(res => {
                    if (res.ok) dlBtn.innerText = "✓";
                    else throw new Error("Failed");
                }).catch(err => {
                    dlBtn.innerText = "×";
                });
            };

            div.appendChild(urlSpan);
            div.appendChild(qualitySpan);
            div.appendChild(dlBtn);
            streamsContainer.appendChild(div);
        });
    });
}

// Event Listeners
interceptToggle.addEventListener("change", (e) => {
    chrome.storage.local.set({ interceptEnabled: e.target.checked });
});
autoCaptureToggle.addEventListener("change", (e) => {
    chrome.storage.local.set({ autoCapture: e.target.checked });
});
refreshBtn.addEventListener("click", () => {
    refreshBtn.style.transform = "rotate(180deg)";
    setTimeout(() => refreshBtn.style.transform = "none", 200);
    loadStreams();
});

// Initialization
checkConnection();
setInterval(checkConnection, 5000);
loadSettings();
loadStreams();
