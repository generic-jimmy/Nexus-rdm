"use strict";
const { v4: uuidv4 } = require("uuid");
const db = require("../config/db");

const audit = ({ userId = null, deviceId = null, action, details = {}, req = null }) => {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, device_id, action, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      userId   ?? null,
      deviceId ?? null,
      action,
      JSON.stringify(details),
      req?.ip ?? null,
      (req?.headers?.["user-agent"] ?? "").slice(0, 256) || null
    );
  } catch (err) {
    console.error("[audit] failed:", err.message);
  }
};

module.exports = { audit };
