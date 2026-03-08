import { db } from "./db";
import { downloads, settings, type Download, type InsertDownload, type Setting, type InsertSetting } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";

export interface IStorage {
  // Downloads
  getDownloads(): Promise<Download[]>;
  getDownloadById(id: string): Promise<Download | undefined>;
  getDownloadByUrl(url: string): Promise<Download | undefined>;
  addDownload(download: InsertDownload): Promise<Download>;
  updateDownload(id: string, update: Partial<Download>): Promise<Download | undefined>;
  deleteDownload(id: string): Promise<boolean>;

  // Settings
  getSettings(): Promise<Setting>;
  updateSettings(update: Partial<Setting>): Promise<Setting>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initSettings();
  }

  private async initSettings() {
    // Ensure default settings exist
    try {
      const existing = await db.select().from(settings).limit(1);
      if (existing.length === 0) {
        const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), "Downloads");
        const defaultSettings = {
          id: 1,
          defaultDownloadPath: defaultPath,
          concurrentDownloads: 3,
          maxRetries: 3,
          speedLimit: 0,
          darkMode: true,
          autoCaptureDownloads: true,
          askBeforeDownload: true,
          browserIntegration: true
        };
        await db.insert(settings).values(defaultSettings);
        console.log("[Storage] Initialized default settings.");
      }
    } catch (e) {
      console.error("[Storage] Failed to initialize settings:", e);
    }
  }

  async getDownloads(): Promise<Download[]> {
    return db.select().from(downloads).orderBy(downloads.createdAt);
  }

  async getDownloadById(id: string): Promise<Download | undefined> {
    const res = await db.select().from(downloads).where(eq(downloads.id, id));
    return res.length > 0 ? res[0] : undefined;
  }

  async getDownloadByUrl(url: string): Promise<Download | undefined> {
    const { or } = await import('drizzle-orm');
    const res = await db
      .select()
      .from(downloads)
      .where(eq(downloads.url, url))
      .limit(1);
    return res.length > 0 ? res[0] : undefined;
  }

  async addDownload(download: InsertDownload): Promise<Download> {
    // Duplicate detection — return existing active download for the same URL 
    const existing = await this.getDownloadByUrl(download.url);
    if (existing && ['downloading', 'queued', 'scheduled'].includes(existing.status)) {
      console.log(`[Storage] Active duplicate download detected for URL: ${download.url} (existing: ${existing.id} / ${existing.status})`);
      return existing;
    }
    const newDownload = { ...download, id: download.id || randomUUID() };
    await db.insert(downloads).values(newDownload);
    return this.getDownloadById(newDownload.id) as Promise<Download>;
  }

  async updateDownload(id: string, update: Partial<Download>): Promise<Download | undefined> {
    await db.update(downloads).set(update).where(eq(downloads.id, id));
    return this.getDownloadById(id);
  }

  async deleteDownload(id: string): Promise<boolean> {
    const res = await db.delete(downloads).where(eq(downloads.id, id));
    return true; // drizzle sqlite doesn't return count easily without changes, assume true
  }

  async getSettings(): Promise<Setting> {
    const res = await db.select().from(settings).limit(1);
    if (res.length > 0) return res[0];

    // Fallback if not init yet
    const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), "Downloads");
    const defaultSettings = { id: 1, defaultDownloadPath: defaultPath, concurrentDownloads: 3, maxRetries: 3, speedLimit: 0, darkMode: true, autoCaptureDownloads: true, askBeforeDownload: true, browserIntegration: true } as Setting;
    await db.insert(settings).values(defaultSettings);
    return defaultSettings;
  }

  async updateSettings(update: Partial<Setting>): Promise<Setting> {
    await db.update(settings).set(update).where(eq(settings.id, 1));
    return this.getSettings();
  }
}

export const storage = new DatabaseStorage();
