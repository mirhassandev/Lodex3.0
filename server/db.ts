import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";
import fs from "fs";

// Determine database path manually since we are in Node.js
const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.local/share");
const userDataPath = path.join(appData, "NexusManager");

if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}

const dbPath = path.join(userDataPath, "nexus.db");
console.log(`[Database] Initializing SQLite database at: ${dbPath} `);

const sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });
