#!/usr/bin/env node

/**
 * Nexus Manager Native Messaging Host
 * This script is launched by Chrome/Edge/Firefox.
 * It communicates via stdin/stdout using the specialized length-prefixed protocol.
 */

const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');

// Log file for debugging
const logPath = path.join(__dirname, 'native-host-debug.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });
function debugLog(msg) {
    logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
}

debugLog("Native Host started.");

const ws = new WebSocket('ws://localhost:8989');
let messageQueue = [];
let isConnected = false;

ws.on('open', () => {
    debugLog("Connected to Nexus Bridge.");
    isConnected = true;
    // Flush queue
    while (messageQueue.length > 0) {
        const fn = messageQueue.shift();
        debugLog(`Flushing queued message.`);
        fn();
    }

});

ws.on('error', (err) => {
    debugLog(`Bridge Connection Error: ${err.message}`);
});

function handleMessage(msg) {
    debugLog(`Handling message: ${msg.type}`);

    const sendAndRespond = () => {
        try {
            ws.send(JSON.stringify(msg));
            debugLog("Message sent to bridge.");
        } catch (e) {
            debugLog(`Failed to send message: ${e.message}`);
        }
        // Acknowledge to Chrome ONLY AFTER we sent it or failed
        sendResponseToChrome({ ok: true });
    };

    if (isConnected) {
        sendAndRespond();
    } else {
        debugLog("Bridge not ready, queuing message.");
        messageQueue.push(sendAndRespond);

        // Timeout just in case Electron isn't running so we don't hang Chrome forever
        setTimeout(() => {
            if (messageQueue.includes(sendAndRespond)) {
                const idx = messageQueue.indexOf(sendAndRespond);
                if (idx > -1) messageQueue.splice(idx, 1);
                debugLog("Timeout waiting for bridge. Aborting message.");
                sendResponseToChrome({ ok: false, error: "Bridge unavailable" });
            }
        }, 5000);
    }
}

function sendResponseToChrome(msg) {
    const buffer = Buffer.from(JSON.stringify(msg));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buffer.length, 0);
    process.stdout.write(header);
    process.stdout.write(buffer);
}

// Robust Stdin Reading for Native Messaging
let inputBuffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);

    while (inputBuffer.length >= 4) {
        const msgLen = inputBuffer.readUInt32LE(0);
        if (inputBuffer.length >= 4 + msgLen) {
            const content = inputBuffer.slice(4, 4 + msgLen);
            inputBuffer = inputBuffer.slice(4 + msgLen);

            try {
                const json = JSON.parse(content.toString());
                handleMessage(json);
            } catch (err) {
                debugLog(`JSON Parse Error: ${err.message}`);
            }
        } else {
            break; // Wait for more data
        }
    }
});

process.stdin.on('end', () => {
    debugLog("Chrome closed the pipe. Exiting.");
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    debugLog(`FATAL: ${err.message}\n${err.stack}`);
});
