// Polyfill File for undici/ytdl-core in Electron (Node 18 environment)
try {
  const { File } = require('node:buffer');
  if (typeof global.File === 'undefined') {
    global.File = File;
  }
} catch (e) {
  console.error("Failed to polyfill File:", e);
}

const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = electron;

let appTray = null;
let downloadTray = null;
let isQuitting = false;

if (!app) {
  // Try to fallback to dummy app or log more info
  console.error('[Electron] Error: `app` is undefined. Environment:', {
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE,
    ELECTRON_NO_ASAR: process.env.ELECTRON_NO_ASAR,
    nodeVersion: process.version,
    electronVersion: process.versions.electron
  });
  // Only exit if not in some weird recovery mode
  if (process.versions.electron) {
    console.warn('[Electron] Running in Electron but app is missing? Proceeding with caution.');
  } else {
    process.exit(1);
  }
}
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');
const { exec } = require('child_process');

// ── Silence noisy Chromium SSL / network logs ─────────────────────────────
// These logs (ssl_client_socket_impl, net_error -101, etc.) are harmless
// internal Chromium messages that flood the console. Suppress them here.
if (app && app.commandLine) {
  app.commandLine.appendSwitch('log-level', '3');        // Only FATAL logs
  app.commandLine.appendSwitch('disable-logging');
  app.commandLine.appendSwitch('silent-launch');
  app.commandLine.appendSwitch('disable-features', 'NetworkService,NetworkServiceInProcess');
}

console.log('[Electron] Starting app...');

let serverProcess = null;
let mainWindow = null;

// Import real downloader
const { DownloadManager } = require('./downloader.cjs');
const dm = new DownloadManager();

/**
 * Super Overkill: Native Messaging Registry Setup
 */
function registerNativeHost() {
  const hostPath = path.join(__dirname, 'native-messaging', 'host-manifest.json');
  const chromeRegKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.nexus.manager.host';
  const edgeRegKey = 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.nexus.manager.host';

  // Chrome
  exec(`reg add "${chromeRegKey}" /ve /t REG_SZ /d "${hostPath}" /f`, (err) => {
    if (err) console.error('[Registry] Failed to register Chrome host:', err);
    else console.log('[Registry] Chrome Native Host registered.');
  });

  // Edge
  exec(`reg add "${edgeRegKey}" /ve /t REG_SZ /d "${hostPath}" /f`, (err) => {
    if (err) console.error('[Registry] Failed to register Edge host:', err);
    else console.log('[Registry] Edge Native Host registered.');
  });
}

/**
 * Super Overkill: Bridge Server
 */
function startBridgeServer() {
  const wss = new WebSocket.Server({ port: 8989 });
  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'DOWNLOAD_SNIFFED') {
          showNewDownloadDialog('browser', data.payload.url, data.payload.headers);
        } else if (data.type === 'REGISTER_EXTENSION') {
          // Dynamically rewrite the host manifest to allow the current extension ID
          const extId = data.id;
          if (extId && extId.length === 32) {
            const hostManifestPath = path.join(__dirname, 'native-messaging', 'host-manifest.json');
            try {
              if (fs.existsSync(hostManifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(hostManifestPath, 'utf8'));
                const newOrigin = `chrome-extension://${extId}/`;
                if (!manifest.allowed_origins.includes(newOrigin)) {
                  manifest.allowed_origins = [newOrigin];
                  fs.writeFileSync(hostManifestPath, JSON.stringify(manifest, null, 2));
                  console.log(`[Bridge] Dynamically registered extension ID: ${extId}`);
                }
              }
            } catch (err) {
              console.error('[Bridge] Failed to update host manifest:', err);
            }
          }
        }
      } catch (e) { }
    });
  });
}

/**
 * Phase 8: HTTP Intercept Server
 * Listens for automatic browser interceptions on port 4578.
 */
// Global cache for captured request headers (Auth/Cookies) 
const capturedHeaders = new Map();

function startInterceptServer() {
  const server = http.createServer((req, res) => {
    // Enable CORS for extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      return res.end();
    }

    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};

        if (req.method === 'POST' && req.url === '/intercept') {
          console.log('[Intercept] Link Intercepted:', data.url, 'Source:', data.source);
          
          // Flatten headers: prioritize explicit data.headers object from extension payload
          const combinedHeaders = {
            'User-Agent': data.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
            'Referer': data.referrer || data.url,
            'Cookie': data.cookies || '',
            ...(data.headers || {}) // Merge any nested headers (idm-style payload)
          };

          showNewDownloadDialog(data.source || 'browser-capture', data.url, combinedHeaders);
        }

        else if (req.method === 'POST' && req.url === '/media-detected') {
          // Log only; passive detection should not interrupt the user with a modal
          console.log('[Media] Stream Detected (Passive):', data.url);
          // Optional: Send to main window only (not a modal)
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('stream-detected-passive', data);
          }
        }
        else if (req.method === 'POST' && req.url === '/capture-headers') {
          console.log('[Intercept] Headers Captured for:', data.url);
          if (data.url && data.headers) {
            capturedHeaders.set(data.url, data.headers);
            // Expiry after 10 mins
            setTimeout(() => capturedHeaders.delete(data.url), 600000);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid Request');
      }
    });
  });

  server.listen(4578, '127.0.0.1', () => {
    console.log('[Intercept] Listening for browser extension on port 4578');
  });
}

function showNewDownloadDialog(source, url, meta = {}) {
  const headers = meta.headers || {};
  console.log(`[Bridge] Opening Dialog for ${source}:`, url);

  const dialogWindow = new BrowserWindow({
    width: 850,
    height: 600,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Tag window for management
  dialogWindow.isDialog = true;


  const baseUrl = process.env.NODE_ENV === 'production'
    ? `file://${path.join(__dirname, '..', 'client', 'dist', 'index.html')}`
    : 'http://localhost:5000'; // Ensure correct vite port

  const dialogUrl = (meta && meta.id) 
    ? `${baseUrl}?dialog=true&id=${meta.id}`
    : `${baseUrl}?dialog=true`;
    
  dialogWindow.loadURL(dialogUrl);

  dialogWindow.once('ready-to-show', () => {
    dialogWindow.show();
  });

  dialogWindow.webContents.on('did-finish-load', () => {
    if (!meta.id) {
      dialogWindow.webContents.send('download-detected', source, url, headers, meta);
    }
  });


  dialogWindow.on('blur', () => {
    if (!dialogWindow.isDestroyed()) {
      dialogWindow.minimize();
    }
  });

  // Self-closing on IPC (target specific window)
  const closeListener = (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === dialogWindow) {
      if (!dialogWindow.isDestroyed()) {
        dialogWindow.close();
        ipcMain.removeListener('dialog/close', closeListener);
      }
    }
  };
  ipcMain.on('dialog/close', closeListener);
}

// Forward download events to renderer and sync DB
dm.on('download', ({ id, event, payload }) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(`download/${event}`, { id, ...payload });
    }
  });

  let updateData = {};
  if (event === 'started') {
    updateData = { status: 'downloading', size: payload.size };
  } else if (event === 'progress') {
    updateData = {
      progress: payload.total ? Math.min(100, Math.round((payload.downloaded / payload.total) * 100)) : 0,
      speed: payload.speed || 0,
      size: payload.total || 0,
    };
  } else if (event === 'finished') {
    // Ensure final size is saved if it was missed during progress
    const task = dm.tasks.get(id);
    updateData = {
      status: 'completed',
      progress: 100,
      speed: 0,
      size: payload.size || (task ? task.size : 0)
    };
  } else if (event === 'error') {
    updateData = { status: 'failed', speed: 0 };
  } else if (event === 'paused') {
    updateData = { status: 'paused', speed: 0 };
  } else if (event === 'resumed') {
    updateData = { status: 'downloading' };
  } else if (event === 'cancelled') {
    updateData = { status: 'cancelled', speed: 0 };
  }

  if (Object.keys(updateData).length > 0) {
    const url = 'http://127.0.0.1:5000/api/downloads/' + id;
    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    }).catch(e => console.error('[Database sync error]', e.message));
  }

  // Dual Tray Update
  updateDownloadTray();
});

function updateDownloadTray() {
  const activeTasks = Array.from(dm.tasks.values()).filter(t => t.status === 'downloading' || t.status === 'queued');
  
  if (activeTasks.length > 0) {
    if (!downloadTray) {
      const iconPath = path.join(__dirname, '..', 'client', 'public', 'download_tray2.0.png');
      downloadTray = new Tray(nativeImage.createFromPath(iconPath));
      downloadTray.setToolTip('Nexus Download Engine');
    }

    // Build Transfer-specific Menu
    const menuItems = [
      { label: 'Restore all download windows', click: () => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (win.isDialog && !win.isDestroyed()) {
              if (win.isVisible() === false) {
                win.show();
              }
              win.focus();
            }

          });
      }},
      { type: 'separator' }
    ];


    activeTasks.slice(0, 5).forEach(task => {
      const filename = path.basename(task.savePath || task.outPath || 'Unknown');
      const denominator = task.size || 0;
      const progressNum = denominator > 0 ? (task.downloaded / denominator) * 100 : 0;
      const progress = `${progressNum.toFixed(1)}%`;
      menuItems.push({ 
        label: `${progress} ${filename}`, 
        click: () => openDownloadProgress(task.id)
      });
    });


    if (activeTasks.length > 5) {
      menuItems.push({ label: `...and ${activeTasks.length - 5} more`, enabled: false });
    }

    downloadTray.setContextMenu(Menu.buildFromTemplate(menuItems));
    } else {
      if (downloadTray) {
        downloadTray.destroy();
        downloadTray = null;
      }
    }
  }



function openDownloadProgress(id) {
  // 1. Check if a window for this ID is already open
  const existing = BrowserWindow.getAllWindows().find(win => win.activeDownloadId === id);
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }

  // 2. Otherwise open a new dialog in progress mode
  const task = dm.tasks.get(id);
  if (task) {
    showNewDownloadDialog('manual', task.url, { id: task.id });
  }
}



function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeout) {
            reject(new Error('Timed out waiting for dev server'));
          } else {
            setTimeout(check, 300);
          }
        });
    };

    check();
  });
}

function startDevServer() {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  serverProcess = spawn(cmd, ['tsx', 'server/index.ts'], {
    env: Object.assign({}, process.env, { NODE_ENV: 'development' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[server] ${data.toString()}`);
  });
  serverProcess.stderr.on('data', (data) => {
    console.error(`[server] ${data.toString()}`);
  });

  serverProcess.on('exit', (code) => {
    console.log('Dev server exited with code', code);
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start dev server:', err);
  });
}

async function createWindow() {
  console.log('[Electron] Creating browser window...');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'client', 'public', 'logo2.0.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[Electron] Window ready to show');
    mainWindow.show();
  });

  if (process.env.NODE_ENV === 'production') {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/downloads');
      const dls = await res.json();
      dm.loadState(dls);
    } catch (e) { console.error('Failed to load DB states', e.message); }

    const indexPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
    console.log('[Electron] Loading production file:', indexPath);
    mainWindow.loadFile(indexPath);
  } else {
    const url = 'http://localhost:5000';
    console.log('[Electron] Waiting for dev server at', url);
    try {
      await waitForServer(url, 30000);
      try {
        const res = await fetch('http://127.0.0.1:5000/api/downloads');
        const dls = await res.json();
        dm.loadState(dls);
      } catch (e) { console.error('Failed to load DB states', e.message); }

      console.log('[Electron] Dev server is ready, loading URL');
      mainWindow.loadURL(url);
    } catch (err) {
      console.error('[Electron] Dev server did not start:', err.message);
      console.log('[Electron] Attempting to load anyway...');
      mainWindow.loadURL(url).catch(e => console.error('Failed to load URL:', e));
    }
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[Electron] Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    console.log('[Electron] Window closed');
    mainWindow = null;
  });
}

app.on('ready', async () => {
  // Overkill Setup - Start these IMMEDIATELY to listen for the browser
  startBridgeServer();
  startInterceptServer();
  registerNativeHost();

  console.log('[Electron] App ready event fired');

  // Build System Tray
  const iconPath = path.join(__dirname, '..', 'client', 'public', 'logo2.0.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) { console.error('Tray icon missing'); }

  appTray = new Tray(trayIcon || nativeImage.createEmpty());
  appTray.setToolTip('Nexus Manager');
  appTray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  appTray.setContextMenu(contextMenu);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Electron] Starting dev server...');
    startDevServer();
    // Give server a moment to start
    await new Promise(r => setTimeout(r, 2000));
  }

  // Load existing downloads from DB into Memory
  try {
    const res = await fetch('http://127.0.0.1:5000/api/downloads');
    if (res.ok) {
      const tasks = await res.json();
      console.log(`[Electron] Restoring ${tasks.length} tasks from DB...`);
      dm.loadState(tasks);
    }
  } catch (err) {
    console.warn('[Electron] Could not restore tasks from DB (Server not ready?):', err.message);
  }

  try {
    await createWindow();
    console.log('[Electron] Window created successfully');
  } catch (err) {
    console.error('[Electron] Failed to create window:', err);
    process.exit(1);
  }
});

app.on('window-all-closed', () => {
  console.log('[Electron] All windows closed (Running in Background)');
});

app.on('before-quit', () => {
  console.log('[Electron] Quitting, killing server...');
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});

// Clipboard Monitor removed as per user request


// Initialization of persistence is now handled by API load.

// IPC Handlers - Window Controls
ipcMain.on('window/minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window/close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('window/maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on('dialog/close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('app/quit', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
  return true;
});

ipcMain.handle('download/delete', async (_event, id) => {
  const result = dm.delete(id);
  if (result) {
    try {
      await fetch('http://127.0.0.1:5000/api/downloads/' + id, { method: 'DELETE' });
    } catch (e) { }
  }
  return result;
});

ipcMain.handle('open/file', async (_event, filePath) => {
  if (!filePath) return false;
  try {
    const absolutePath = path.resolve(filePath);
    await shell.openPath(absolutePath);
    return true;
  } catch (e) {
    console.error('[Open] Failed to open file:', filePath, e);
    return false;
  }
});

ipcMain.handle('open/folder', async (_event, filePath) => {
  if (!filePath) return false;
  try {
    const absolutePath = path.resolve(filePath);
    await shell.showItemInFolder(absolutePath);
    return true;
  } catch (e) {
    console.error('[Open] Failed to show folder:', filePath, e);
    return false;
  }
});

ipcMain.handle('download/list', async () => {
  return dm.getAllTasks();
});

ipcMain.handle('download/move-up', async (_event, id) => {
  dm.queueManager.moveUp(id);
  return { ok: true };
});

ipcMain.handle('download/move-down', async (_event, id) => {
  dm.queueManager.moveDown(id);
  return { ok: true };
});

ipcMain.handle('download/update-priority', async (_event, id, priority) => {
  const task = dm.tasks.get(id);
  if (task) {
    task.priority = priority;
    // If it's in waiting, re-sort
    dm.queueManager._sortWaiting();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('settings/refresh', async () => {
  console.log('[Electron] Refreshing settings from API...');
  await dm._fetchSettings();
  return { ok: true };
});

ipcMain.handle('dialog/select-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Stream quality inspection IPC
const { inspectHLSPlaylist, inspectDASHManifest } = require('./stream-downloader.cjs');
const { classify } = require('./url-classifier.cjs');
const { getYtdlpPath } = require('./ytdlp-wrapper.cjs');


ipcMain.handle('stream/get-info', async (_event, url, providedHeaders = {}) => {
  try {
    const isHLS = url.includes('.m3u8') || url.includes('m3u8?');
    const isDASH = url.includes('.mpd') || url.includes('mpd?');

    // Merge captured headers if available
    const captured = capturedHeaders.get(url) || {};
    const headers = { ...captured, ...providedHeaders };

    if (isHLS) {
      const info = await inspectHLSPlaylist(url, headers);
      return { ok: true, protocol: 'hls', ...info };
    } else if (isDASH) {
      const info = await inspectDASHManifest(url, headers);
      return { ok: true, protocol: 'dash', ...info };
    } else {
      return { ok: false, message: 'Not a recognized streaming URL' };
    }
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// URL Classifier IPC — used by React UI to pre-populate download dialog
ipcMain.handle('url/classify', async (_event, url, providedHeaders = {}) => {
  try {
    // Merge captured headers if available
    const captured = capturedHeaders.get(url) || {};
    const headers = { ...captured, ...providedHeaders };
    
    const meta = await classify(url, headers);
    return { ok: true, ...meta };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.handle('system/get-disk-info', async (_event, folderPath) => {
  return new Promise((resolve) => {
    // Default to app's partition if no path
    const driveLetter = (folderPath || __dirname).substring(0, 1).toUpperCase();
    
    // Using wmic as a standard Windows way to get disk metrics
    exec(`wmic logicaldisk where "DeviceID='${driveLetter}:'" get FreeSpace,Size /value`, (err, stdout) => {
      if (err) {
        console.error('[DiskInfo] Error:', err);
        return resolve({ free: 0, total: 0, used: 0, percent: 0 });
      }

      const lines = stdout.split('\n');
      let free = 0;
      let total = 0;

      lines.forEach(line => {
        if (line.includes('FreeSpace=')) free = parseInt(line.split('=')[1]);
        if (line.includes('Size=')) total = parseInt(line.split('=')[1]);
      });

      const used = total - free;
      const percent = total > 0 ? Math.round((used / total) * 100) : 0;

      resolve({
        free,
        total,
        used,
        percent,
        drive: driveLetter
      });
    });
  });
});


// Media Analyzer IPC — returns full quality options for quality selector UI
const { analyzeMedia } = require('./media-analyzer.cjs');

ipcMain.handle('media/analyze', async (_event, url, classification = null, providedHeaders = {}) => {
  try {
    // Merge captured headers if available
    const captured = capturedHeaders.get(url) || {};
    const headers = { ...captured, ...providedHeaders };

    const result = await analyzeMedia(url, classification, headers);
    return { ok: true, ...result };
  } catch (e) {
    console.error('[IPC] media/analyze failed:', e.message);
    return { ok: false, message: e.message };
  }
});

const { MediaExtractor } = require('./media-extractor.cjs');

// IPC Handlers - Real download integration
ipcMain.handle('youtube/get-info', async (_event, url) => {
  console.log('[IPC] YouTube info requested:', url);
  try {
    const { spawn } = require('child_process');
    const ytpPath = getYtdlpPath();


    return new Promise((resolve) => {
      const args = [
        url,
        '--dump-json',
        '--no-warnings',
        '--flat-playlist',
        '--no-check-certificate',
        '--quiet',
        '--no-video-multistreams',
        '--no-playlist',
        '--socket-timeout', '10'
      ];

      // Inject Captured Headers (Cookies/Auth) if available
      const savedHeaders = capturedHeaders.get(url);
      if (savedHeaders) {
        Object.entries(savedHeaders).forEach(([key, value]) => {
          if (value) args.push('--add-header', `${key}:${value}`);
        });
      } else {
        // Fallback defaults if no headers captured
        try {
          const u = new URL(url);
          args.push('--add-header', `referer:${u.protocol}//${u.host}/`);
        } catch {
          args.push('--add-header', 'referer:https://www.google.com/');
        }
        args.push('--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
      }

      const subprocess = spawn(ytpPath, args);


      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        subprocess.kill();
        resolve({ ok: false, message: 'Metadata fetch timed out' });
      }, 15000);

      subprocess.stdout.on('data', (data) => stdout += data.toString());
      subprocess.stderr.on('data', (data) => stderr += data.toString());

      subprocess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          try {
            const info = JSON.parse(stdout);
            const title = info.title;
            const formats = info.formats || [];

            // Robust resolution extraction
            const resolutions = [...new Set(formats
              .filter(f => (f.vcodec !== 'none' || f.acodec !== 'none') && f.height)
              .map(f => f.height))]
              .sort((a, b) => b - a);

            const bestResolutions = resolutions.length > 0 ? resolutions : [1080, 720, 480, 360];

            resolve({ ok: true, title, resolutions: bestResolutions, formats });

          } catch (e) {
            resolve({ ok: false, message: 'Parse error' });
          }
        } else {
          resolve({ ok: false, message: stderr || `Exit ${code}` });
        }
      });
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('download/start', async (_event, url, options = {}) => {
  console.log('[IPC] Download start requested:', url, options);
  try {
    if (!url || typeof url !== 'string') {
      return { ok: false, message: 'Invalid URL' };
    }

    // Use original title or custom filename if provided by frontend
    let filename = options.filename;

    // Enforce extensions if missing
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (options.isAudioOnly || options.quality === 'audio') {
        if (!filename.toLowerCase().endsWith('.mp3')) {
          filename += ".mp3";
        }
      } else if (!filename.toLowerCase().endsWith('.mp4')) {
        filename += ".mp4";
      }
    } else if (!filename.includes('.')) {
      filename += '.zip';
    }

    // Inject captured headers if available
    if (capturedHeaders.has(url)) {
      console.log('[Capture] Injecting headers for:', url);
      options.headers = { ...capturedHeaders.get(url), ...options.headers };
    }

    // Sanitize filename
    filename = filename.replace(/[<>:"|\\?*]/g, '_');

    // Save to downloads folder or custom path
    const downloadsFolder = app.getPath('downloads');
    const outPath = options.savePath ? path.join(options.savePath, filename) : path.join(downloadsFolder, filename);

    // Save to DB first
    let dbId;
    try {
      const { randomUUID } = require('crypto');
      const scheduledAtValue = options.scheduledAt ? new Date(options.scheduledAt) : null;
      const statusValue = options.status || 'queued';
      const res = await fetch('http://127.0.0.1:5000/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: randomUUID(),
          url,
          filename,
          filePath: outPath,
          status: statusValue,
          progress: 0,
          size: 0,
          scheduledAt: scheduledAtValue,
          priority: options.priority || 'normal'
        })
      });
      if (!res.ok) throw new Error('API Response not ok');
      const dbRow = await res.json();
      dbId = dbRow.id;
    } catch (err) {
      console.error('[IPC] Failed to save DB record:', err.message);
      dbId = undefined; // Will fallback to local ID generated in downloader
    }

    // Create download task — passes scheduledAt & status so the queue manager can hold it
    const task = await dm.create(url, outPath, {
      connections: options.connections || 8,
      resolution: options.quality,
      title: options.title,
      type: options.type,
      protocol: options.protocol,
      isAudioOnly: options.isAudioOnly || options.quality === 'audio',
      headers: options.headers || {},
      scheduledAt: options.scheduledAt || null,
      status: options.status || 'queued',
      priority: options.priority || 'normal'
    }, dbId);

    // Notify ALL windows so both main and dialog windows get the new entry
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('download/created', {
          id: task.id,
          name: filename,
          url: url,
          status: task.status || options.status || 'queued',
          progress: 0,
          size: task.size,
          outPath: outPath,
          scheduledAt: options.scheduledAt || null,
          dateAdded: new Date().toISOString().split('T')[0]
        });
      }
    });

    try {
      console.log('[IPC] Download queued with ID:', task.id);

      // Tag the requesting window with the active download ID if it's the dialog window
      const senderWin = BrowserWindow.fromWebContents(_event.sender);
      if (senderWin) senderWin.activeDownloadId = task.id;

      return { ok: true, id: task.id, outPath, filename, size: task.size || 0 };
    } catch (err) {
      console.error('[IPC] Failed to queue download:', err.message);
      return { ok: false, message: err.message || 'Failed to queue download' };
    }
  } catch (err) {
    console.error('[IPC] Download start error:', err);
    return { ok: false, message: err.message || 'Invalid URL' };
  }
});

// New IPC: Check if any open dialog window is actively showing this download
ipcMain.handle('is-dialog-open', (_event, downloadId) => {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed() && win.activeDownloadId === downloadId) {
      // Must also be physically visible
      if (win.isVisible()) {
        return true;
      }
    }
  }
  return false;
});

ipcMain.handle('download/pause', (_event, id) => {
  console.log('[IPC] Download pause requested:', id);
  try {
    // Find task in any active downloads
    const allTasks = Array.from(dm.tasks.values());
    const task = allTasks.find(t => t.id === id);
    if (!task) {
      return { ok: false, message: 'Download not found' };
    }
    task.pause();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('download/resume', (_event, id) => {
  console.log('[IPC] Download resume requested:', id);
  try {
    const allTasks = Array.from(dm.tasks.values());
    const task = allTasks.find(t => t.id === id);
    if (!task) {
      return { ok: false, message: 'Download not found' };
    }
    task.resume();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('download/cancel', (_event, id) => {
  console.log('[IPC] Download cancel requested:', id);
  try {
    const allTasks = Array.from(dm.tasks.values());
    const task = allTasks.find(t => t.id === id);
    if (!task) {
      return { ok: false, message: 'Download not found' };
    }
    task.cancel();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});
