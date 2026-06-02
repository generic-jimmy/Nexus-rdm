"use strict";
require("dotenv").config();

// DB import runs schema creation immediately on require — synchronous, safe
require("./config/db");

const express = require("express");
const http    = require("http");
const path    = require("path");
const helmet  = require("helmet");
const { WebSocketServer } = require("ws");

const { apiLimiter }  = require("./middleware/rateLimiter");
const authRoutes      = require("./routes/auth");
const deviceRoutes    = require("./routes/devices");

const app    = express();
const server = http.createServer(app);

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com"],
        imgSrc:     ["'self'", "data:"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Health check — no DB call needed, schema already ran at startup
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", version: "1.0.0", ts: new Date().toISOString() })
);

app.use("/api",         apiLimiter);
app.use("/api/auth",    authRoutes);
app.use("/api/devices", deviceRoutes);

// Serve built React (same origin)
const STATIC = path.join(__dirname, "..", "public");
app.use(express.static(STATIC, { maxAge: "1y", immutable: true }));

// SPA fallback
app.get("*", (req, res) => {
  if (req.path.startsWith("/api"))
    return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(STATIC, "index.html"), { maxAge: 0 });
});

// WebSocket hub
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[ws] type=${msg.type} from ${ip}`);
    } catch {
      ws.send(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
  ws.on("close", () => console.log(`[ws] disconnected ${ip}`));
  ws.on("error", (e) => console.error(`[ws] error:`, e.message));
  ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
});

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30_000);

wss.on("close", () => clearInterval(pingInterval));

app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = parseInt(process.env.PORT ?? "4000", 10);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ NexusRDM listening on :${PORT}  [${process.env.NODE_ENV ?? "development"}]`);
});

const shutdown = (sig) => {
  console.log(`[shutdown] ${sig}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
