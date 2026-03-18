import { db } from "./db";
import { settings, downloads, queues, type Setting, type InsertSetting, type Download, type InsertDownload, type Queue, type InsertQueue } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Settings
  getSettings(): Promise<Setting>;
  updateSettings(update: Partial<Setting>): Promise<Setting>;

  getDownloads(): Promise<Download[]>;
  createDownload(download: InsertDownload): Promise<Download>;
  updateDownload(id: number, update: Partial<Download>): Promise<Download>;
  deleteDownload(id: number): Promise<boolean>;

  // Queues
  getQueues(): Promise<Queue[]>;
  createQueue(queue: InsertQueue): Promise<Queue>;
  deleteQueue(id: number): Promise<boolean>;
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
        const defaultSettings = {
          id: 1,
          darkMode: true,
        };
        await db.insert(settings).values(defaultSettings);
        console.log("[Storage] Initialized default metrics.");
      }
    } catch (e) {
      console.error("[Storage] Failed to initialize settings:", e);
    }
  }

  // --- Settings ---
  async getSettings(): Promise<Setting> {
    const res = await db.select().from(settings).limit(1);
    if (res.length > 0) return res[0];

    // Fallback if not init yet
    const defaultSettings = { id: 1, darkMode: true } as Setting;
    await db.insert(settings).values(defaultSettings);
    return defaultSettings;
  }

  async updateSettings(update: Partial<Setting>): Promise<Setting> {
    await db.update(settings).set(update).where(eq(settings.id, 1));
    return this.getSettings();
  }

  // --- Downloads ---
  async getDownloads(): Promise<Download[]> {
    return await db.select().from(downloads);
  }

  async createDownload(item: InsertDownload): Promise<Download> {
    console.log(`[Storage] Creating download: ${item.filename}`);
    try {
      const [newItem] = await db.insert(downloads).values(item).returning();
      console.log(`[Storage] Created with ID: ${newItem.id}`);
      return newItem;
    } catch (e: any) {
      console.error(`[Storage] Create failed: ${e.message}`);
      throw e;
    }
  }

  async updateDownload(id: number, update: Partial<Download>): Promise<Download> {
    const [updated] = await db
      .update(downloads)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(downloads.id, id))
      .returning();
    return updated;
  }

  async deleteDownload(id: number): Promise<boolean> {
    await db.delete(downloads).where(eq(downloads.id, id));
    return true; 
  }

  // --- Queues ---
  async getQueues(): Promise<Queue[]> {
    return await db.select().from(queues);
  }

  async createQueue(item: InsertQueue): Promise<Queue> {
    const [newQueue] = await db.insert(queues).values(item).returning();
    return newQueue;
  }

  async deleteQueue(id: number): Promise<boolean> {
    // Note: In a real app, we might want to move downloads from this queue back to "Main Queue" (ID 1)
    await db.delete(queues).where(eq(queues.id, id));
    return true;
  }
}

export const storage = new DatabaseStorage();
