import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import express from "express";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // express.json() is already configured in index.ts

  // --- Downloads API ---
  app.get("/api/downloads", async (req, res) => {
    try {
      const downloads = await storage.getDownloads();
      res.json(downloads);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/downloads/:id", async (req, res) => {
    try {
      const download = await storage.getDownloadById(req.params.id);
      if (!download) return res.status(404).json({ error: "Not found" });
      res.json(download);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/downloads", async (req, res) => {
    try {
      const download = await storage.addDownload(req.body);
      res.status(201).json(download);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/downloads/:id", async (req, res) => {
    try {
      const download = await storage.updateDownload(req.params.id, req.body);
      if (!download) return res.status(404).json({ error: "Not found" });
      res.json(download);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/downloads/:id", async (req, res) => {
    try {
      await storage.deleteDownload(req.params.id);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Browser Extension SDK / Bridge ---
  app.get("/api/ping", (req, res) => {
    res.json({ pong: true, status: "online", version: "1.0.0" });
  });

  app.post("/api/browser/download", async (req, res) => {
    try {
      const payload = req.body;
      if (!payload.url) {
        return res.status(400).json({ error: "Missing streaming URL" });
      }

      // We bridge this directly to the Electron main process via WebSocket
      // This allows the desktop app to pop up the IDM-style dialog instantly.
      const WebSocket = await import("ws");
      const ws = new WebSocket.WebSocket("ws://127.0.0.1:8989");

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "DOWNLOAD_SNIFFED",
          payload: {
            url: payload.url,
            headers: {
              referer: payload.referer
            },
            filename: payload.filename,
            mimeType: payload.mimeType,
            quality: payload.quality
          }
        }));
        ws.close();
      });

      ws.on("error", (e) => {
        console.error("Bridge to Desktop failed", e);
      });

      res.status(200).json({ success: true, message: "Queued successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
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

  return httpServer;
}
