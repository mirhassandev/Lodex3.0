const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const env = { ...process.env };
// Remove variables that force electron to run as node
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ASAR;
delete env.ELECTRON_INTERNAL_CRASH_REPORTER_DUMP_URL;

// On Windows, use the .cmd version of the binary in node_modules
const electronPath = path.join(process.cwd(), 'node_modules', '.bin', 'electron.cmd');

console.log('Starting electron from:', electronPath);

const chromiumFlags = [
    '--log-level=3',                  // Only show FATAL errors (suppresses SSL noise)
    '--disable-logging',              // Disable Chromium logging to console
    '--no-sandbox',                   // Needed in some Windows environments
    '--disable-gpu-sandbox',
    '--disable-features=NetworkService,NetworkServiceInProcess',
    '--silent-launch',
];

const proc = spawn(`"${electronPath}"`, ['.', ...chromiumFlags], {
    env,
    stdio: 'inherit',
    detached: true,
    shell: true
});

proc.on('error', (err) => {
    console.error('Failed to start electron:', err);
});

proc.unref();

// Give it a second before exiting the launcher
setTimeout(() => {
    console.log('Launcher exiting, electron should be running.');
    process.exit(0);
}, 2000);
