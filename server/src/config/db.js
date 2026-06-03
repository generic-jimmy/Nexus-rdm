"use strict";
const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

// /app/data is a named Docker volume — persists across restarts and redeploys
// Local dev: falls back to ./data next to the project root
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "..", "data");
const DB_PATH  = path.join(DATA_DIR, "nexusrdm.db");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH, {
  verbose: process.env.NODE_ENV === "development"
    ? (s) => console.log("[sql]", s.slice(0, 120))
    : undefined,
});

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("synchronous = NORMAL");

// ─── Schema ───────────────────────────────────────────────────────────────────
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
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT UNIQUE NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    user_agent  TEXT,
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    api_key_hash       TEXT UNIQUE NOT NULL,
    api_key_prefix     TEXT NOT NULL,
    owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tags               TEXT NOT NULL DEFAULT '[]',
    os                 TEXT,
    os_version         TEXT,
    hostname           TEXT,
    username           TEXT,
    ip_address         TEXT,
    arch               TEXT,
    cpu_model          TEXT,
    cpu_cores          INTEGER,
    ram_total          INTEGER,
    ram_used           INTEGER,
    disk_total         INTEGER,
    disk_used          INTEGER,
    battery_percent    INTEGER,
    battery_charging   INTEGER,
    agent_version      TEXT,
    status             TEXT NOT NULL DEFAULT 'offline'
                         CHECK (status IN ('online','offline','warning')),
    last_seen          TEXT,
    ping_ms            INTEGER,
    heartbeat_interval INTEGER NOT NULL DEFAULT 30,
    metadata           TEXT NOT NULL DEFAULT '{}',
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    device_id   TEXT,
    action      TEXT NOT NULL,
    details     TEXT NOT NULL DEFAULT '{}',
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_refresh_user   ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_hash   ON refresh_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_devices_owner  ON devices(owner_id);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_device   ON audit_logs(device_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_logs(created_at);
`);

console.log(`[db] SQLite ready: ${DB_PATH}`);

module.exports = db;
