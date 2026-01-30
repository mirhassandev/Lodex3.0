// Polyfill File for undici/ytdl-core in Electron (Node 18 environment)
try {
  const { File } = require('node:buffer');
  if (typeof global.File === 'undefined') {
    global.File = File;
  }
} catch (e) {
  console.error("Failed to polyfill File:", e);
}

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { URL } = require('url');

console.log('[Electron] Starting app...');

let serverProcess = null;
let mainWindow = null;

// Import real downloader
const { DownloadManager } = require('./downloader.cjs');
const dm = new DownloadManager();

// Forward download events to renderer
dm.on('download', ({ id, event, payload }) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(`download/${event}`, { id, ...payload });
  }
});

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

  mainWindow.on('closed', () => {
    console.log('[Electron] Window closed');
    mainWindow = null;
  });
}

app.on('ready', async () => {
  console.log('[Electron] App ready event fired');
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Electron] Starting dev server...');
    startDevServer();
    // Give server a moment to start
    await new Promise(r => setTimeout(r, 1000));
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
  console.log('[Electron] All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] Quitting, killing server...');
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});

// Clipboard Monitor
const { clipboard } = require('electron');
let lastClipboardText = '';
setInterval(() => {
  const text = clipboard.readText();
  if (text && text !== lastClipboardText) {
    lastClipboardText = text;
    // Simple URL validation
    if (text.startsWith('http://') || text.startsWith('https://')) {
      // Validate URL object
      try {
        new URL(text);
        if (mainWindow && mainWindow.webContents) {
          console.log('[Clipboard] URL detected:', text);
          mainWindow.webContents.send('download-detected', text);
        }
      } catch (e) { }
    }
  }
}, 1000);

// Initialize persistence
const userDataPath = app.getPath('userData');
const downloadsStatePath = path.join(userDataPath, 'downloads.json');
console.log('[Electron] Downloads state path:', downloadsStatePath);
dm.setPersistencePath(downloadsStatePath);

// IPC Handlers - Real download integration
ipcMain.handle('download/delete', async (_event, id) => {
  return dm.delete(id);
});

ipcMain.handle('open/file', async (_event, filePath) => {
  if (!filePath) return false;
  try {
    await shell.openPath(filePath);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('open/folder', async (_event, filePath) => {
  if (!filePath) return false;
  try {
    await shell.showItemInFolder(filePath);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('download/list', async () => {
  return dm.getAllTasks(); // You'll need to implement a detailed GetAllTasks if the basic one isn't enough, but the array mapping in downloader.cjs covered it.
});

const { MediaExtractor } = require('./media-extractor.cjs');

// IPC Handlers - Real download integration
ipcMain.handle('youtube/get-info', async (_event, url) => {
  console.log('[IPC] YouTube info requested:', url);
  try {
    const { spawn } = require('child_process');
    const ytpPath = path.join(__dirname, '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');

    return new Promise((resolve, reject) => {
      const subprocess = spawn(ytpPath, [
        url,
        '--dump-json',
        '--no-warnings',
        '--prefer-free-formats',
        '--add-header', 'referer:youtube.com',
        '--add-header', 'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      ]);

      let stdout = '';
      let stderr = '';

      subprocess.stdout.on('data', (data) => stdout += data.toString());
      subprocess.stderr.on('data', (data) => stderr += data.toString());

      subprocess.on('close', (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(stdout);
            const title = info.title;
            const resolutions = [...new Set(info.formats
              .filter(f => f.vcodec !== 'none' && f.height)
              .map(f => f.height))]
              .sort((a, b) => b - a);

            resolve({ ok: true, title, resolutions });
          } catch (e) {
            reject(new Error('Failed to parse YouTube metadata'));
          }
        } else {
          reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        }
      });
    });
  } catch (err) {
    console.error('[IPC] Failed to get YouTube info:', err);
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('download/start', async (_event, url, options = {}) => {
  console.log('[IPC] Download start requested:', url, options);
  try {
    if (!url || typeof url !== 'string') {
      return { ok: false, message: 'Invalid URL' };
    }

    // Use original title if provided by frontend from metadata
    let filename = options.title ? `${options.title}.mp4` : MediaExtractor.getFilename(url);

    // Sanitize filename
    filename = filename.replace(/[<>:"|?*]/g, '_');

    // Save to downloads folder
    const outPath = path.join(app.getPath('downloads'), filename);

    // Create and start download task with quality options
    const task = dm.create(url, outPath, {
      connections: 6,
      resolution: options.quality,
      title: options.title
    });

    try {
      await task.start();
      console.log('[IPC] Download started with ID:', task.id);
      dm.saveState(); // Save state immediately
      return { ok: true, id: task.id, outPath, filename, size: task.size };
    } catch (err) {
      console.error('[IPC] Failed to start download:', err.message);
      return { ok: false, message: err.message || 'Failed to start download' };
    }
  } catch (err) {
    console.error('[IPC] Download start error:', err);
    return { ok: false, message: err.message || 'Invalid URL' };
  }
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
