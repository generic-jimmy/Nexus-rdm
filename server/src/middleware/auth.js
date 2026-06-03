"use strict";
const crypto           = require("crypto");
const { verifyAccess } = require("../utils/auth");
const db               = require("../config/db");

const authenticate = (req, res, next) => {
  try {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "No token provided" });

    const payload = verifyAccess(header.slice(7));
    const user    = db.prepare(
      "SELECT id, email, name, role, totp_enabled FROM users WHERE id = ?"
    ).get(payload.sub);

    if (!user) return res.status(401).json({ error: "User not found" });

    req.user = { ...user, totp_enabled: !!user.totp_enabled };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError")
      return res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: "Insufficient permissions" });
  next();
};

const authenticateDevice = (req, res, next) => {
  try {
    const key = req.headers["x-device-key"] ?? "";
    if (!key) return res.status(401).json({ error: "No device key" });

    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    const device  = db.prepare(
      "SELECT id, name, owner_id, heartbeat_interval FROM devices WHERE api_key_hash = ?"
    ).get(keyHash);

    if (!device) return res.status(401).json({ error: "Invalid device key" });
    req.device = device;
    next();
  } catch (err) {
    console.error("[auth/device]", err.message);
    return res.status(500).json({ error: "Auth error" });
  }
};

module.exports = { authenticate, requireRole, authenticateDevice };
