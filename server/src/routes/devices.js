"use strict";
const express  = require("express");
const crypto   = require("crypto");
const { v4: uuidv4 } = require("uuid");
const router   = express.Router();

const db = require("../config/db");
const { authenticate, requireRole, authenticateDevice } = require("../middleware/auth");
const { generateDeviceKey }  = require("../utils/auth");
const { audit }              = require("../middleware/audit");
const { deviceLimiter }      = require("../middleware/rateLimiter");

// ─── GET /api/devices ─────────────────────────────────────────────────────────
router.get("/", authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, api_key_prefix, tags, os, hostname, ip_address,
           status, last_seen, heartbeat_interval, metadata, created_at
    FROM devices WHERE owner_id = ? ORDER BY created_at DESC
  `).all(req.user.id);

  // Parse JSON fields
  const devices = rows.map(parseDevice);
  res.json({ devices });
});

// ─── GET /api/devices/stats ───────────────────────────────────────────────────
router.get("/stats", authenticate, (req, res) => {
  const row = db.prepare(`
    SELECT
      COUNT(*)                               AS total,
      SUM(CASE WHEN status='online'  THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN status='offline' THEN 1 ELSE 0 END) AS offline,
      SUM(CASE WHEN status='warning' THEN 1 ELSE 0 END) AS warning
    FROM devices WHERE owner_id = ?
  `).get(req.user.id);
  res.json(row);
});

// ─── POST /api/devices ────────────────────────────────────────────────────────
router.post("/", authenticate, requireRole("admin", "operator"), (req, res) => {
  const { name, tags = [], heartbeat_interval = 30 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Device name required" });

  const interval = Math.min(300, Math.max(10, parseInt(heartbeat_interval, 10) || 30));
  const rawKey   = generateDeviceKey();
  const keyHash  = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPfx   = rawKey.slice(0, 12);
  const id       = uuidv4();

  db.prepare(`
    INSERT INTO devices (id, name, api_key_hash, api_key_prefix, owner_id, tags, heartbeat_interval)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), keyHash, keyPfx, req.user.id, JSON.stringify(tags), interval);

  audit({ userId: req.user.id, deviceId: id, action: "device.created", req });

  const device = db.prepare(
    "SELECT id, name, api_key_prefix, tags, status, heartbeat_interval, created_at FROM devices WHERE id = ?"
  ).get(id);

  res.status(201).json({ device: parseDevice(device), apiKey: rawKey });
});

// ─── GET /api/devices/:id ─────────────────────────────────────────────────────
router.get("/:id", authenticate, (req, res) => {
  const device = db.prepare(`
    SELECT id, name, api_key_prefix, tags, os, hostname, ip_address,
           status, last_seen, heartbeat_interval, metadata, created_at
    FROM devices WHERE id = ? AND owner_id = ?
  `).get(req.params.id, req.user.id);

  if (!device) return res.status(404).json({ error: "Device not found" });
  res.json({ device: parseDevice(device) });
});

// ─── PATCH /api/devices/:id ───────────────────────────────────────────────────
router.patch("/:id", authenticate, requireRole("admin", "operator"), (req, res) => {
  const { name, tags, heartbeat_interval } = req.body;

  const existing = db.prepare("SELECT * FROM devices WHERE id = ? AND owner_id = ?")
    .get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: "Device not found" });

  const newName     = name               ?? existing.name;
  const newTags     = tags               != null ? JSON.stringify(tags) : existing.tags;
  const newInterval = heartbeat_interval ?? existing.heartbeat_interval;

  db.prepare(`
    UPDATE devices SET name = ?, tags = ?, heartbeat_interval = ?, updated_at = datetime('now')
    WHERE id = ? AND owner_id = ?
  `).run(newName, newTags, newInterval, req.params.id, req.user.id);

  const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
  res.json({ device: parseDevice(device) });
});

// ─── DELETE /api/devices/:id ──────────────────────────────────────────────────
router.delete("/:id", authenticate, requireRole("admin"), (req, res) => {
  const result = db.prepare("DELETE FROM devices WHERE id = ? AND owner_id = ?")
    .run(req.params.id, req.user.id);

  if (!result.changes) return res.status(404).json({ error: "Device not found" });
  audit({ userId: req.user.id, deviceId: req.params.id, action: "device.deleted", req });
  res.json({ ok: true });
});

// ─── POST /api/devices/heartbeat — called by Windows agent ───────────────────
router.post("/heartbeat", deviceLimiter, authenticateDevice, (req, res) => {
  const { os, hostname, ip_address, metadata = {} } = req.body;

  const existing = db.prepare("SELECT metadata FROM devices WHERE id = ?").get(req.device.id);
  const merged   = { ...JSON.parse(existing?.metadata || "{}"), ...metadata };

  db.prepare(`
    UPDATE devices SET
      status     = 'online',
      last_seen  = datetime('now'),
      os         = COALESCE(?, os),
      hostname   = COALESCE(?, hostname),
      ip_address = COALESCE(?, ip_address),
      metadata   = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(os ?? null, hostname ?? null, ip_address ?? null, JSON.stringify(merged), req.device.id);

  res.json({ ok: true, interval: req.device.heartbeat_interval });
});

// ─── GET /api/devices/audit/:id ───────────────────────────────────────────────
router.get("/audit/:id", authenticate, (req, res) => {
  const logs = db.prepare(`
    SELECT action, details, ip_address, created_at
    FROM audit_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(req.params.id);

  res.json({ logs: logs.map((l) => ({ ...l, details: JSON.parse(l.details || "{}") })) });
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function parseDevice(d) {
  if (!d) return d;
  return {
    ...d,
    tags:     JSON.parse(d.tags     || "[]"),
    metadata: JSON.parse(d.metadata || "{}"),
  };
}

module.exports = router;
