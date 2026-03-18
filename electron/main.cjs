const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = electron;

let appTray = null;
let downloadTray = null;
let isQuitting = false;

if (!app) {
  process.exit(1);
}
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const http = require('http');
const { URL } = require('url');

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatETA(seconds) {
  if (!seconds || seconds === Infinity || seconds < 0) return '--';
  if (seconds < 60) return Math.floor(seconds) + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.floor(seconds % 60) + 's';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
}

// ── Download Engine Integration ──────────────────────────────────────────
const { startDownload, getEngineType } = require('./downloader.cjs');
const activeDownloads = new Map(); // Track active child processes

/**
 * DOWNLOAD MANAGER (dm)
 * Manages the persistent state and queue of all downloads.
 * Syncs with the SQLite backend via the API.
 */
class DownloadManager {
  constructor() {
    this.tasks = new Map();
    this.settings = { darkMode: true, maxConcurrent: 4 };
    this.updateThrottles = new Map();
    this.isProcessing = false;
  }

  async loadState(tasks) {
    console.log(`[DM] Loading ${tasks.length} tasks...`);
    tasks.forEach(task => this.tasks.set(task.id, task));
    this._processQueue(); // Kickstart the queue
  }

  async create(url) {
    const engine = getEngineType(url);
    const filename = url.split('/').pop() || 'download';
    const body = {
      url,
      filename,
      engine,
      status: 'pending',
      savePath: './downloads'
    };
    console.log('[DM] Creating task with payload:', JSON.stringify(body));
    try {
      const res = await fetch('http://127.0.0.1:5000/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const task = await res.json();
        console.log('[DM] Task created successfully:', task.id);
        this.tasks.set(task.id, task);
        return task;
      } else {
        const errorText = await res.text();
        console.error(`[DM] API error (${res.status}):`, errorText);
      }
    } catch (e) {
      console.error('[DM] Network/Fetch error:', e.message);
    }
    return null;
  }

  async update(id, data) {
    const task = this.tasks.get(id);
    if (!task) return;
    Object.assign(task, data);

    // Math Engine: Speed and ETA
    if (data.downloadedBytes !== undefined && data.totalBytes !== undefined) {
       const now = Date.now();
       const prevTime = task._lastTime || now;
       const prevBytes = task._lastBytes || 0;
       const dt = (now - prevTime) / 1000; // seconds
       
       if (dt > 0.5) { // Update speed stats every half second
          const db = data.downloadedBytes - prevBytes;
          const currentSpeed = db / dt; // bytes per second
          
          // Simple smoothing (ema)
          task._smoothedSpeed = task._smoothedSpeed ? (task._smoothedSpeed * 0.7 + currentSpeed * 0.3) : currentSpeed;
          task._lastTime = now;
          task._lastBytes = data.downloadedBytes;
          
          // Format speed
          task.speed = formatSpeed(task._smoothedSpeed);
          
          // Calculate ETA
          const remaining = data.totalBytes - data.downloadedBytes;
          if (task._smoothedSpeed > 0) {
             const etaSecs = remaining / task._smoothedSpeed;
             task.eta = formatETA(etaSecs);
          } else {
             task.eta = 'Infinity';
          }
       }
    }

    // If status changed, we may need to process the queue
    if (data.status && data.status !== task.status) {
       this._processQueue();
    }

    // Throttle DB updates to 2 seconds per task ID, unless it's a status change
    const now = Date.now();
    const lastUpdate = this.updateThrottles.get(id) || 0;
    const isStatusChange = data.status && data.status !== task.status;

    if (isStatusChange || (now - lastUpdate > 2000)) {
      this.updateThrottles.set(id, now);
      try {
        await fetch(`http://127.0.0.1:5000/api/downloads/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } catch (e) {}
    }
  }

  delete(id) {
    this.tasks.delete(id);
    return true;
  }

  get(id) {
    return this.tasks.get(id);
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  async _processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      const max = this.settings.maxConcurrent || 4;
      
      while (true) {
         const allTasks = this.getAllTasks().sort((a,b) => (a.priority || 0) - (b.priority || 0));
         const downloading = allTasks.filter(t => t.status === 'downloading');
         if (downloading.length >= max) break;
         
         const nextTask = allTasks.find(t => t.status === 'pending');
         if (!nextTask) break;
         
         console.log(`[Queue] Auto-starting: ${nextTask.filename}`);
         await this.startTask(nextTask.id);
      }
    } catch (e) {
      console.error('[Queue] Error:', e);
    } finally {
      this.isProcessing = false;
    }
  }

  async startTask(id) {
     const task = this.get(id);
     if (!task || task.status === 'downloading' || task.status === 'completed') return;

     // 1. Mark as downloading
     this.update(id, { status: 'downloading' });
     
     // 2. Start the engine
     const { startDownload } = require('./downloader.cjs');
     const child = startDownload(task.url, {
      onEngineId: (sid) => {
        this.update(id, { surgeId: sid });
      },
      onFilename: (newName) => {
        this.update(id, { filename: newName });
        if (mainWindow) {
           mainWindow.webContents.send('download-progress', { id, filename: newName });
        }
      },
      onProgress: (progress) => {
        this.update(id, { status: 'downloading', ...progress });
        if (mainWindow) {
           mainWindow.webContents.send('download-progress', { id, ...progress });
        }
      },
      onComplete: () => {
        // For surge, we wait for the poller
        if (task.engine !== 'surge') {
           this.update(id, { status: 'completed', percentage: 100 });
           activeDownloads.delete(id);
        }
      },
      onError: (err) => {
        this.update(id, { status: 'error' });
        activeDownloads.delete(id);
      }
    });

    if (child) {
      activeDownloads.set(id, child);
    }
  }

  async moveUp(id) {
    const all = this.getAllTasks().sort((a,b) => (a.priority || 0) - (b.priority || 0));
    const idx = all.findIndex(t => t.id === id);
    if (idx > 0) {
      const t1 = all[idx];
      const t2 = all[idx-1];
      const p1 = t1.priority;
      t1.priority = t2.priority;
      t2.priority = p1;
      await this.update(t1.id, { priority: t1.priority });
      await this.update(t2.id, { priority: t2.priority });
      this._processQueue();
    }
  }

  async moveDown(id) {
    const all = this.getAllTasks().sort((a,b) => (a.priority || 0) - (b.priority || 0));
    const idx = all.findIndex(t => t.id === id);
    if (idx < all.length - 1) {
      const t1 = all[idx];
      const t2 = all[idx+1];
      const p1 = t1.priority;
      t1.priority = t2.priority;
      t2.priority = p1;
      await this.update(t1.id, { priority: t1.priority });
      await this.update(t2.id, { priority: t2.priority });
      this._processQueue();
    }
  }

  async _fetchSettings() {
    try {
      const res = await fetch('http://127.0.0.1:5000/api/settings');
      if (res.ok) this.settings = await res.json();
    } catch (e) {}
  }
}

const dm = new DownloadManager();

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
let surgeServerProcess = null;
let mainWindow = null;

function startSurgeServer() {
  console.log('[Surge] Starting background server...');
  const binDir = path.join(process.cwd(), 'resources', 'bin');
  const surgePath = path.join(binDir, 'surge.exe');
  
  surgeServerProcess = spawn(surgePath, ['server'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true // Hide the terminal window
  });

  surgeServerProcess.stdout.on('data', (data) => {
    console.log(`[surge-server] ${data.toString().trim()}`);
  });

  surgeServerProcess.stderr.on('data', (data) => {
    console.error(`[surge-server-err] ${data.toString().trim()}`);
  });

  surgeServerProcess.on('exit', (code) => {
    console.log(`[Surge] Server exited with code ${code}`);
  });
}

function startSurgePoller() {
  const downloadsDir = path.resolve(process.cwd(), 'downloads');
  setInterval(async () => {
    if (!fs.existsSync(downloadsDir)) return;
    
    // Get latest surge status
    const binDir = path.join(process.cwd(), 'resources', 'bin');
    const surgePath = path.join(binDir, 'surge.exe');
    
    try {
      const { exec } = require('child_process');
      exec(`"${surgePath}" ls`, { windowsHide: true }, (err, stdout) => {
        if (err) return;
        
        const lines = stdout.split('\n');
        const surgeTasks = [];
        lines.forEach(line => {
          const parts = line.trim().split(/\s{2,}/);
          if (parts.length >= 4 && parts[0] !== 'ID' && parts[0].length >= 8) {
            surgeTasks.push({
              sid: parts[0],
              filename: parts[1],
              status: parts[2].toLowerCase(),
              progress: parts[3],
              speed: parts[4] || '-',
              size: parts[5] || '-'
            });
          }
        });

        // Match with our DM tasks
        surgeTasks.forEach(st => {
          let foundTask = null;
          // Strategy 1: Match by surgeId
          for (const t of dm.tasks.values()) {
            if (t.surgeId === st.sid) {
              foundTask = t;
              break;
            }
          }
          // Strategy 2: Match by filename if no SID yet
          if (!foundTask) {
             for (const t of dm.tasks.values()) {
               if (t.filename === st.filename && t.engine === 'surge' && t.status !== 'completed') {
                 foundTask = t;
                 t.surgeId = st.sid; // Link it!
                 break;
               }
             }
          }

          if (foundTask) {
             const percent = parseFloat(st.progress) || 0;
             const isNowCompleted = st.status === 'completed' || percent >= 100;
             
             // Update memory and DB
             if (foundTask.status !== 'completed' && isNowCompleted) {
                dm.update(foundTask.id, { status: 'completed', percentage: 100, speed: '-' });
                // Rename logic
                renameSurgeFile(downloadsDir, st.filename);
             } else if (foundTask.status === 'downloading' || foundTask.status === 'pending') {
                const newStatus = st.status === 'downloading' ? 'downloading' : foundTask.status;
                dm.update(foundTask.id, { status: newStatus, percentage: percent, speed: st.speed });
             }

             // Send to UI
             if (mainWindow) {
                mainWindow.webContents.send('download-progress', {
                  id: foundTask.id,
                  status: foundTask.status,
                  percentage: foundTask.percentage,
                  speed: foundTask.speed,
                  filename: foundTask.filename
                });
             }
          }
        });
      });
    } catch (e) {}
  }, 3000); // Poll every 3 seconds
}

function renameSurgeFile(downloadsDir, baseName) {
  try {
    const files = fs.readdirSync(downloadsDir);
    files.forEach(file => {
      if (file.startsWith(baseName) && file.endsWith('.surge')) {
         const oldPath = path.join(downloadsDir, file);
         const cleanName = file.replace(/\.surge$/, '');
         const newPath = path.join(downloadsDir, cleanName);
         if (fs.existsSync(oldPath)) {
            if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
            fs.renameSync(oldPath, newPath);
            console.log(`[Poller] Renamed completed: ${cleanName}`);
         }
      }
    });
  } catch (e) {}
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

    const indexPath = path.join(__dirname, '..', 'client', 'dist', 'index.html');
    console.log('[Electron] Loading production file:', indexPath);
    mainWindow.loadFile(indexPath);
  } else {
    const url = 'http://localhost:5000';
    console.log('[Electron] Waiting for dev server at', url);
    try {
      await waitForServer(url, 30000);

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
    // Start Surge server as well
    startSurgeServer();
    // Give servers a moment to start
    await new Promise(r => setTimeout(r, 2000));
  } else {
    // In production, still need Surge
    startSurgeServer();
  }

  // Start the background poller for Surge
  startSurgePoller();

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
  if (surgeServerProcess) {
    console.log('[Surge] Stopping background server...');
    surgeServerProcess.kill('SIGINT'); // Surge usually prefers SIGINT to save state
  }
});

// Zombie Prevention: Kill all active downloads on quit
app.on('will-quit', () => {
  console.log(`[Electron] Quitting, killing ${activeDownloads.size} active downloads...`);
  activeDownloads.forEach((child, id) => {
    if (child) child.kill('SIGINT');
  });
  activeDownloads.clear();
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

ipcMain.handle('download/delete', async (_event, id, deleteFile = false) => {
  const task = dm.get(id);
  if (task && deleteFile) {
    try {
      const downloadsDir = path.resolve(process.cwd(), 'downloads');
      const filePath = path.join(downloadsDir, task.filename);
      const surgePath = filePath + '.surge';
      
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(surgePath)) fs.unlinkSync(surgePath);
      
      // Also remove from surge server if it's a surge task
      if (task.engine === 'surge') {
         const binDir = path.join(process.cwd(), 'resources', 'bin');
         const surgeBin = path.join(binDir, 'surge.exe');
         const { exec } = require('child_process');
         // We might not have the SID here if it was a historical task, 
         // but we can try to find it by filename and remove it.
         exec(`"${surgeBin}" ls`, (err, stdout) => {
            if (!err) {
               const lines = stdout.split('\n');
               lines.forEach(line => {
                  if (line.includes(task.filename)) {
                     const sid = line.trim().split(/\s+/)[0];
                     if (sid && sid.length >= 8) exec(`"${surgeBin}" rm ${sid}`);
                  }
               });
            }
         });
      }
      console.log(`[Delete] Deleted file for task ${id}: ${task.filename}`);
    } catch (e) {
      console.error(`[Delete] Failed to delete file for task ${id}:`, e.message);
    }
  }

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
  return await dm.moveUp(id);
});

ipcMain.handle('download/move-down', async (_event, id) => {
  return await dm.moveDown(id);
});

ipcMain.handle('download/set-concurrency', async (_event, limit) => {
  dm.settings.maxConcurrent = limit;
  dm._processQueue();
  
  // Persist to DB
  try {
    await fetch('http://127.0.0.1:5000/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxConcurrent: limit })
    });
  } catch (e) {}
  
  return true;
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

// Stream quality inspection IPC removed/refactored (missing files)
// const { inspectHLSPlaylist, inspectDASHManifest } = require('./stream-downloader.cjs');
// const { classify } = require('./url-classifier.cjs');


ipcMain.handle('stream/get-info', async (_event, url, providedHeaders = {}) => {
  return { ok: false, message: 'Stream inspection currently unavailable' };
});

// URL Classifier IPC — used by React UI to pre-populate download dialog
ipcMain.handle('url/classify', async (_event, url, providedHeaders = {}) => {
  try {
    // Basic classification using the new downloader
    const engineType = getEngineType(url);
    return { ok: true, type: engineType, domain: new URL(url).hostname };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

/**
 * DOWNLOAD ENGINE IPC
 * Routes URLs to the correct engine and streams progress.
 */
ipcMain.handle('trigger-download', async (event, url) => {
  try {
    const requestId = Date.now();
    const { getEngineType } = require('./downloader.cjs');
    const engineType = getEngineType(url);
    const existingTasks = dm.getAllTasks();
    const maxPriority = existingTasks.length > 0 ? Math.max(...existingTasks.map(t => t.priority || 0)) : 0;

    // 1. Create task state (Always starts as PENDING)
    const newTask = {
      id: requestId,
      url: url,
      filename: url.split('/').pop().split('?')[0] || 'download',
      status: 'pending',
      percentage: 0,
      totalSize: '0',
      speed: '0 KB/s',
      priority: maxPriority + 1,
      engine: engineType
    };
    dm.tasks.set(requestId, newTask);

    // 2. Save to DB
    try {
      await fetch('http://127.0.0.1:5000/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTask)
      });
    } catch (e) { }

    // 3. Trigger the Queue Worker
    dm._processQueue();

    // 4. Send immediate "Pending" status to UI
    event.sender.send('download-progress', {
      id: requestId,
      status: 'pending',
      engine: engineType,
      percentage: 0,
      filename: newTask.filename
    });

    return { ok: true, task: newTask };
  } catch (err) {
    console.error('Trigger Error:', err);
    return { ok: false, error: err.message };
  }
});

// IPC handler to manually cancel a download
ipcMain.handle('download/cancel', async (_event, requestId) => {
  const child = activeDownloads.get(requestId);
  if (child) {
    child.kill('SIGINT');
    activeDownloads.delete(requestId);
    return { ok: true };
  }
  return { ok: false, message: 'Process not found' };
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


process.on('uncaughtException', (err) => {
  console.error('[Electron] Uncaught exception:', err);
});
