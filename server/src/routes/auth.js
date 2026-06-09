"use strict";
const express  = require("express");
const { body, validationResult } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const router   = express.Router();

const db = require("../config/db");
const {
  hashPassword, verifyPassword,
  signAccess, signRefresh, verifyAccess, verifyRefresh,
  generateRefreshRaw, hashToken, REFRESH_TTL_MS,
  generateTotpSecret, verifyTotp, totpUri, totpQR,
  encryptSecret, decryptSecret,
} = require("../utils/auth");
const { authenticate }              = require("../middleware/auth");
const { loginLimiter, totpLimiter } = require("../middleware/rateLimiter");
const { audit }                     = require("../middleware/audit");

const MAX_FAILS  = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

// ─── POST /api/auth/register — first-run only ─────────────────────────────────
router.post(
  "/register",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 12 }).withMessage("Minimum 12 characters"),
    body("name").trim().notEmpty().withMessage("Name required"),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    try {
      const existing = db.prepare("SELECT id FROM users LIMIT 1").get();
      if (existing)
        return res.status(403).json({ error: "Registration closed. Contact your admin." });

      const { email, password, name } = req.body;
      const id   = uuidv4();
      const hash = await hashPassword(password);

      db.prepare(
        "INSERT INTO users (id, email, password, name, role) VALUES (?, ?, ?, ?, 'admin')"
      ).run(id, email, hash, name);

      audit({ userId: id, action: "user.registered", req });
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err.message?.includes("UNIQUE"))
        return res.status(409).json({ error: "Email already in use" });
      console.error("[auth/register]", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  "/login",
  loginLimiter,
  [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, password } = req.body;
    try {
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

      const sentinel = "$argon2id$v=19$m=65536,t=3,p=4$c2VudGluZWwxMjM$sentinelhash12345678901234";
      const valid    = await verifyPassword(user?.password ?? sentinel, password);

      if (!valid || !user)
        return res.status(401).json({ error: "Invalid credentials" });

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        audit({ userId: user.id, action: "login.blocked_locked", req });
        return res.status(423).json({ error: "Account locked. Try again later." });
      }

      if (!valid) {
        const fails     = (user.failed_logins ?? 0) + 1;
        const lockUntil = fails >= MAX_FAILS
          ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
        db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
          .run(fails, lockUntil, user.id);
        audit({ userId: user.id, action: "login.failed", details: { fails }, req });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      db.prepare(
        "UPDATE users SET failed_logins=0, locked_until=NULL, last_login=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?"
      ).run(user.id);

      if (user.totp_enabled === 1) {
        const tempToken = signAccess({ sub: user.id, type: "2fa_pending" });
        audit({ userId: user.id, action: "login.2fa_required", req });
        return res.json({ require2fa: true, tempToken });
      }

      const tokens = issueTokens(user.id, user.role, user.email);
      audit({ userId: user.id, action: "login.success", req });
      res.json({ user: safe(user), ...tokens });
    } catch (err) {
      console.error("[auth/login]", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// ─── POST /api/auth/2fa/verify ────────────────────────────────────────────────
router.post("/2fa/verify", totpLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code)
    return res.status(400).json({ error: "tempToken and code required" });

  try {
    let payload;
    try { payload = verifyAccess(tempToken); }
    catch { return res.status(401).json({ error: "Invalid or expired token" }); }

    if (payload.type !== "2fa_pending")
      return res.status(400).json({ error: "Wrong token type" });

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user?.totp_secret) return res.status(401).json({ error: "2FA not configured" });

    const secret = decryptSecret(user.totp_secret);
    if (!verifyTotp(code, secret)) {
      audit({ userId: user.id, action: "2fa.verify.failed", req });
      return res.status(401).json({ error: "Invalid 2FA code" });
    }

    const tokens = issueTokens(user.id, user.role, user.email);
    audit({ userId: user.id, action: "login.success.2fa", req });
    res.json({ user: safe(user), ...tokens });
  } catch (err) {
    console.error("[auth/2fa/verify]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post("/refresh", (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "No refresh token" });

  try {
    try { verifyRefresh(refreshToken); }
    catch { return res.status(401).json({ error: "Invalid refresh token", code: "REFRESH_INVALID" }); }

    const hash = hashToken(refreshToken);
    const row  = db.prepare(`
      SELECT rt.user_id, u.email, u.role
      FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ? AND rt.revoked = 0
        AND datetime(rt.expires_at) > datetime('now')
    `).get(hash);

    if (!row)
      return res.status(401).json({ error: "Refresh token invalid or expired", code: "REFRESH_INVALID" });

    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(hash);
    const tokens = issueTokens(row.user_id, row.role, row.email);
    res.json(tokens);
  } catch (err) {
    console.error("[auth/refresh]", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post("/logout", authenticate, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken)
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?")
      .run(hashToken(refreshToken));
  audit({ userId: req.user.id, action: "logout", req });
  res.json({ ok: true });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

// ─── GET /api/auth/2fa/setup ──────────────────────────────────────────────────
router.get("/2fa/setup", authenticate, async (req, res) => {
  if (req.user.totp_enabled)
    return res.status(400).json({ error: "2FA already enabled" });
  const secret    = generateTotpSecret();
  const uri       = totpUri(req.user.email, secret);
  const qrCode    = await totpQR(uri);
  const encrypted = encryptSecret(secret);
  db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(encrypted, req.user.id);
  res.json({ qrCode, manualKey: secret });
});

// ─── POST /api/auth/2fa/enable ────────────────────────────────────────────────
router.post("/2fa/enable", authenticate, totpLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "code required" });
  const user = db.prepare("SELECT totp_secret FROM users WHERE id = ?").get(req.user.id);
  if (!user?.totp_secret) return res.status(400).json({ error: "Call /2fa/setup first" });
  if (!verifyTotp(code, decryptSecret(user.totp_secret)))
    return res.status(400).json({ error: "Invalid code" });
  db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(req.user.id);
  audit({ userId: req.user.id, action: "2fa.enabled", req });
  res.json({ ok: true });
});

// ─── POST /api/auth/2fa/disable ───────────────────────────────────────────────
router.post("/2fa/disable", authenticate, totpLimiter, async (req, res) => {
  const { code, password } = req.body;
  if (!code || !password) return res.status(400).json({ error: "code and password required" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  if (!(await verifyPassword(user.password, password)))
    return res.status(401).json({ error: "Wrong password" });
  if (!verifyTotp(code, decryptSecret(user.totp_secret)))
    return res.status(400).json({ error: "Invalid code" });
  db.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(req.user.id);
  audit({ userId: req.user.id, action: "2fa.disabled", req });
  res.json({ ok: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function issueTokens(userId, role, email) {
  const accessToken = signAccess({ sub: userId, role, email });
  const rawRefresh  = generateRefreshRaw();
  const hash        = hashToken(rawRefresh);
  const expiresAt   = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

  db.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).run(uuidv4(), userId, hash, expiresAt);

  // Keep only last 5 per user
  const old = db.prepare(
    "SELECT id FROM refresh_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 5"
  ).all(userId);
  if (old.length) {
    const placeholders = old.map(() => "?").join(",");
    db.prepare(`DELETE FROM refresh_tokens WHERE id IN (${placeholders})`).run(...old.map(r => r.id));
  }

  return { accessToken, refreshToken: rawRefresh };
}

function safe(user) {
  const { password, totp_secret, failed_logins, locked_until, ...u } = user;
  return { ...u, totp_enabled: !!u.totp_enabled };
}


// ─── GET /api/auth/ws-token — short-lived token for WebSocket auth ────────────
// Access tokens last 15min which is fine, but new tabs don't refresh automatically.
// This returns a fresh 5-minute token specifically for WS connections.
router.get("/ws-token", authenticate, (req, res) => {
  const { signAccess } = require("../utils/auth");
  const wsToken = signAccess({ sub: req.user.id, role: req.user.role, email: req.user.email, ws: true });
  res.json({ token: wsToken });
});

module.exports = router;
