import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), // Usually just ID 1
  darkMode: integer("dark_mode", { mode: 'boolean' }).notNull().default(true),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const downloads = sqliteTable("downloads", {
  id: integer("id").primaryKey(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("pending"),
  percentage: integer("percentage").notNull().default(0),
  speed: text("speed").notNull().default("0 KB/s"),
  engine: text("engine").notNull().default("aria2c"),
  savePath: text("save_path").notNull(),
  priority: text("priority").notNull().default("normal"), // low, normal, high
  retryCount: integer("retry_count").notNull().default(0),
  scheduledAt: integer("scheduled_at", { mode: 'timestamp' }),
  queueId: integer("queue_id").references(() => queues.id),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const queues = sqliteTable("queues", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;
export type Download = typeof downloads.$inferSelect;
export type InsertDownload = typeof downloads.$inferInsert;
export type Queue = typeof queues.$inferSelect;
export type InsertQueue = typeof queues.$inferInsert;
