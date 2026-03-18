const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * REGEX HELPERS
 * Captures percentages from various CLI tools.
 */
const REGEX = {
  // yt-dlp: [download]  10.5% of ... (flexible for double spaces)
  YTDLP: /\[download\]\s+(\d+\.\d+)%/,
  // aria2c: (10%) or [10%]
  ARIA2: /\((\d+)%\)/,
  // surge: 10.5% (generic catch-all)
  SURGE: /(\d+(\.\d+)?)%/,
  // Filename targets
  FILENAME_YTDLP: /\[download\] Destination:\s+(.+)/,
  FILENAME_YTDLP_EXIST: /\[download\]\s+(.+)\s+has already been downloaded/,
  FILENAME_ARIA2: /FILE:\s+(.+)/,
  FILENAME_ARIA2_RENAMED: /Renamed to\s+(.+)\./,
  FILENAME_SURGE: /Download target:\s+(.+)/,
  ID_SURGE: /([a-f0-9]{8})\s+.+/
};

/**
 * SPEED EXTRACTION HELPERS
 */
const SPEED_REGEX = {
  YTDLP: /at\s+([\d.]+\w+\/s)/,
  ARIA2: /DL:([\d.]+\w+)/,
  SURGE: /([\d.]+\w+\/s)/
};

/**
 * PATH RESOLVER
 * Ensures binaries are found in dev and packaged builds.
 */
const getBinPath = () => {
  // Try project root resources first (dev)
  const devPath = path.join(process.cwd(), 'resources', 'bin');
  if (fs.existsSync(devPath)) return devPath;

  // Fallback to packaged resources path
  const prodPath = path.join(process.resourcesPath, 'bin');
  return prodPath;
};

/**
 * ENGINE ROUTER
 * Simple logic to decide which binary to use based on URL.
 */
function getEngineType(url) {
  const videoSites = [
    'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 
    'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 
    'vimeo.com', 'dailymotion.com'
  ];
  
  if (videoSites.some(site => url.includes(site))) return 'yt-dlp';
  
  return 'surge'; // Re-prioritize surge for direct/p2p downloads
}

/**
 * MAIN DOWNLOAD FUNCTION
 * @returns {ChildProcess} - The spawned process for management
 */
function startDownload(url, callbacks) {
  const { onProgress, onComplete, onError, onFilename, onEngineId } = callbacks;
  let filenameFound = false;
  const binDir = getBinPath();
  const type = getEngineType(url);

  // Ensure downloads directory exists
  const downloadsDir = path.resolve(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
  }
  
  // Resolve binary paths
  const ENGINES = {
    'yt-dlp': path.join(binDir, 'yt-dlp.exe'),
    'aria2c': path.join(binDir, 'aria2c.exe'),
    'surge': path.join(binDir, 'surge.exe'),
    'ffmpeg': path.join(binDir, 'ffmpeg.exe')
  };

  let cmd = ENGINES[type];
  let args = [];

  if (type === 'surge') {
     // Pre-emptive purge: check if surge already has this file completed
     // This prevents the "done instantly" issue when the file was already downloaded/broken.
     try {
       const { execSync } = require('child_process');
       const lsOutput = execSync(`"${ENGINES['surge']}" ls`, { windowsHide: true }).toString();
       const lines = lsOutput.split('\n');
       
       // Try to extract filename from URL
       const fileNameFromUrl = url.split('/').pop()?.split('?')[0] || '';
       
       lines.forEach(line => {
         const parts = line.trim().split(/\s{2,}/);
         if (parts.length >= 3) {
            const surgeId = parts[0];
            const surgeFileName = parts[1];
            const surgeStatus = parts[2].toLowerCase();
            
            // If the filename matches and it's completed, remove it to force fresh download
            const urlPath = fileNameFromUrl.toLowerCase();
            const surgeName = surgeFileName.toLowerCase();

            if (surgeName.includes(urlPath) && (surgeStatus === 'completed' || surgeStatus === 'finished')) {
               console.log(`[Surge] Purging existing task: ${surgeId} (${surgeFileName})`);
               execSync(`"${ENGINES['surge']}" rm ${surgeId}`, { windowsHide: true });
            }
         }
       });
     } catch (e) {
       console.error('[Surge] Purge failed:', e.message);
     }
  }

  // Argument Routing
  if (type === 'yt-dlp') {
    args = [
      url, 
      '--newline', 
      '--ffmpeg-location', ENGINES['ffmpeg'],
      '-o', '%(title)s.%(ext)s'
    ];
  } else if (type === 'surge') {
    // surge get/add is the command to queue a download
    args = ['get', '--output', downloadsDir, url];
  } else if (type === 'aria2c') {
    // --summary-interval=1 for frequent progress updates
    args = [url, '--summary-interval=1', '--dir', downloadsDir];
  }

  console.log(`[Downloader] Spawning ${type}: ${cmd} ${args.join(' ')}`);

  const child = spawn(cmd, args);

  child.stdout.on('data', (data) => {
    const output = data.toString().replace(/\r/g, '\n'); // Normalize carriage returns
    let progressMatch, speedMatch;

    if (type === 'yt-dlp') {
      progressMatch = output.match(REGEX.YTDLP);
      speedMatch = output.match(SPEED_REGEX.YTDLP);
    } else if (type === 'aria2c') {
      progressMatch = output.match(REGEX.ARIA2);
      speedMatch = output.match(SPEED_REGEX.ARIA2);
    } else {
      progressMatch = output.match(REGEX.SURGE);
      speedMatch = output.match(SPEED_REGEX.SURGE);
    }

    if (progressMatch) {
      onProgress({
        percentage: parseFloat(progressMatch[1]),
        speed: speedMatch ? speedMatch[1] : 'Calculating...',
        engine: type,
        raw: output.trim()
      });
    }

    if (type === 'surge') {
      const idMatch = output.match(REGEX.ID_SURGE);
      if (idMatch && idMatch[1] && onEngineId) {
        onEngineId(idMatch[1]);
      }
    }

    // Filename detection (only emit once)
    if (onFilename && !filenameFound) {
      let nameMatch;
      if (type === 'yt-dlp') {
        nameMatch = output.match(REGEX.FILENAME_YTDLP) || output.match(REGEX.FILENAME_YTDLP_EXIST);
      } else if (type === 'aria2c') {
        nameMatch = output.match(REGEX.FILENAME_ARIA2) || output.match(REGEX.FILENAME_ARIA2_RENAMED);
      } else if (type === 'surge') {
        nameMatch = output.match(REGEX.FILENAME_SURGE);
      }

      if (nameMatch && nameMatch[1]) {
        const detectedName = path.basename(nameMatch[1].trim());
        if (detectedName && detectedName !== 'download') {
          console.log(`[Downloader] Detected filename: ${detectedName}`);
          filenameFound = true;
          onFilename(detectedName);
        }
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[${type} Error]: ${data}`);
  });

  child.on('close', (code) => {
    console.log(`[Downloader] ${type} finished with code ${code}`);
    if (code === 0) {
      // Special handling for surge: strip .surge extension if present
      if (type === 'surge') {
        // Wait a bit for file handles to be released
        setTimeout(() => {
          try {
            const files = fs.readdirSync(downloadsDir);
            files.forEach(file => {
              if (file.endsWith('.surge')) {
                const oldPath = path.join(downloadsDir, file);
                const newName = file.replace(/\.surge$/, '');
                const newPath = path.join(downloadsDir, newName);
                
                if (fs.existsSync(oldPath)) {
                  console.log(`[Downloader] Attempting rename: ${file} -> ${newName}`);
                  try {
                    if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                    fs.renameSync(oldPath, newPath);
                    console.log(`[Downloader] Successfully renamed to ${newName}`);
                  } catch (e) {
                    console.error(`[Downloader] Immediate rename failed (locked?), will retry in 2s...`);
                    setTimeout(() => {
                      try {
                        if (fs.existsSync(oldPath)) {
                           if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                           fs.renameSync(oldPath, newPath);
                           console.log(`[Downloader] Retry rename successful: ${newName}`);
                        }
                      } catch (e2) {
                        console.error('[Downloader] Final rename retry failed:', e2.message);
                      }
                    }, 2000);
                  }
                }
              }
            });
          } catch (e) {
            console.error('[Downloader] Directory read failed during rename:', e);
          }
        }, 800);
      }
      onComplete();
    } else {
      onError(new Error(`${type} exited with code ${code}`));
    }
  });

  child.on('error', (err) => {
    console.error(`[${type}] Failed to start:`, err);
    onError(err);
  });

  return child;
}

module.exports = { startDownload, getEngineType };
