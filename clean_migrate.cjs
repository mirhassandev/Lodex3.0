const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
const userDataPath = path.join(appData, "NexusManager");
const dbPath = path.join(userDataPath, "nexus.db");

console.log(`[Clean Migration] Target: ${dbPath}`);
const db = new Database(dbPath);

try {
  // Drop tables to ensure a clean slate
  db.exec("DROP TABLE IF EXISTS downloads;");
  db.exec("DROP TABLE IF EXISTS queues;");
  db.exec("DROP TABLE IF EXISTS settings;");
  console.log("[Clean Migration] Old tables dropped.");

  // Re-create settings
  db.exec(`
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dark_mode INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );`);

  // Re-create queues
  db.exec(`
  CREATE TABLE queues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );`);

  // Insert default "Main Queue"
  db.prepare("INSERT INTO queues (name) VALUES (?)").run("Main Queue");

  // Re-create downloads with queue_id
  const sql = `
  CREATE TABLE downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    percentage INTEGER NOT NULL DEFAULT 0,
    speed TEXT NOT NULL DEFAULT '0 KB/s',
    engine TEXT NOT NULL DEFAULT 'aria2c',
    save_path TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    retry_count INTEGER NOT NULL DEFAULT 0,
    scheduled_at INTEGER,
    queue_id INTEGER REFERENCES queues(id),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );`;

  db.exec(sql);
  console.log("[Clean Migration] New tables created successfully.");
} catch (err) {
  console.error("[Clean Migration] Error:", err.message);
}

db.close();
