const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
const userDataPath = path.join(appData, "NexusManager");

if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

const dbPath = path.join(userDataPath, "nexus.db");
console.log(`[Manual Migration] Accessing database at: ${dbPath}`);

const db = new Database(dbPath);

// Table creation script matching public const downloads = sqliteTable(...) in shared/schema.ts
const sql = `
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  percentage INTEGER NOT NULL DEFAULT 0,
  speed TEXT NOT NULL DEFAULT '0 KB/s',
  engine TEXT NOT NULL DEFAULT 'surge',
  save_path TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);`;

try {
  db.exec(sql);
  console.log("[Manual Migration] 'downloads' table is ready.");
} catch (err) {
  console.error("[Manual Migration] Error:", err.message);
  process.exit(1);
}

db.close();
