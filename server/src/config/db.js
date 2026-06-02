"use strict";
const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

// ─── DB file location ─────────────────────────────────────────────────────────
// In production (Docker/Render/Railway): mount a persistent volume at /data
// In local dev: stored in the project root
const DB_DIR  = process.env.DB_DIR || path.join(__dirname, "..", "..", "..", "data");
const DB_FILE = path.join(DB_DIR, "nexusrdm.db");

// Ensure data directory exists
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_FILE, {
  verbose: process.env.NODE_ENV === "development"
    ? (sql) => console.log("[sql]", sql.slice(0, 120))
    : undefined,
});

// WAL mode: much better concurrent read/write performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// ─── Schema — runs on every startup, IF NOT EXISTS = fully safe ───────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin'
                    CHECK (role IN ('admin','operator','viewer')),
    totp_secret   TEXT,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until  TEXT,
    last_login    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    user_agent  TEXT,
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    api_key_hash       TEXT UNIQUE NOT NULL,
    api_key_prefix     TEXT NOT NULL,
    owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tags               TEXT NOT NULL DEFAULT '[]',
    os                 TEXT,
    hostname           TEXT,
    ip_address         TEXT,
    status             TEXT NOT NULL DEFAULT 'offline'
                         CHECK (status IN ('online','offline','warning')),
    last_seen          TEXT,
    heartbeat_interval INTEGER NOT NULL DEFAULT 30,
    metadata           TEXT NOT NULL DEFAULT '{}',
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    device_id   TEXT REFERENCES devices(id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    details     TEXT NOT NULL DEFAULT '{}',
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_user   ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_hash   ON refresh_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_devices_owner  ON devices(owner_id);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_device   ON audit_logs(device_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_logs(created_at);
`);

console.log(`[db] SQLite ready: ${DB_FILE}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
// better-sqlite3 is fully synchronous — no async/await needed
// .get()  → single row or undefined
// .all()  → array of rows
// .run()  → { changes, lastInsertRowid }

module.exports = db;
