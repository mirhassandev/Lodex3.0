import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const downloads = sqliteTable("downloads", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status", { enum: ["queued", "downloading", "paused", "completed", "failed", "cancelled", "scheduled", "retrying"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  size: integer("size").notNull().default(0),
  speed: integer("speed").notNull().default(0),
  priority: text("priority", { enum: ["high", "normal", "low"] }).notNull().default("normal"),
  retryCount: integer("retry_count").notNull().default(0),
  scheduledAt: integer("scheduled_at", { mode: 'timestamp' }),
  mimeType: text("mime_type"),
  sourceSite: text("source_site"),
  videoQuality: text("video_quality"),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), // Usually just ID 1
  defaultDownloadPath: text("default_download_path").notNull(),
  concurrentDownloads: integer("concurrent_downloads").notNull().default(3),
  maxRetries: integer("max_retries").notNull().default(3),
  speedLimit: integer("speed_limit").notNull().default(0), // 0 means unlimited
  darkMode: integer("dark_mode", { mode: 'boolean' }).notNull().default(true),
  autoCaptureDownloads: integer("auto_capture_downloads", { mode: 'boolean' }).notNull().default(true),
  askBeforeDownload: integer("ask_before_download", { mode: 'boolean' }).notNull().default(true),
  browserIntegration: integer("browser_integration", { mode: 'boolean' }).notNull().default(true),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export type Download = typeof downloads.$inferSelect;
export type InsertDownload = typeof downloads.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;
