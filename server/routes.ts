import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import express from "express";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // express.json() is already configured in index.ts

  // --- Browser Extension SDK / Bridge ---
  app.get("/api/ping", (req, res) => {
    res.json({ pong: true, status: "online", version: "1.0.0" });
  });

  // --- Settings API ---
  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Downloads API ---
  app.get("/api/downloads", async (req, res) => {
    try {
      const downloads = await storage.getDownloads();
      res.json(downloads);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/downloads", async (req, res) => {
    console.log("[API] POST /api/downloads", req.body);
    try {
      const download = await storage.createDownload(req.body);
      res.json(download);
    } catch (e: any) {
      console.error("[API] POST failed:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/downloads/:id", async (req, res) => {
    try {
      const download = await storage.updateDownload(Number(req.params.id), req.body);
      res.json(download);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/downloads/:id", async (req, res) => {
    try {
      await storage.deleteDownload(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Queues API ---
  app.get("/api/queues", async (req, res) => {
    try {
      const queues = await storage.getQueues();
      res.json(queues);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/queues", async (req, res) => {
    try {
      const queue = await storage.createQueue(req.body);
      res.json(queue);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/queues/:id", async (req, res) => {
    try {
      await storage.deleteQueue(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
