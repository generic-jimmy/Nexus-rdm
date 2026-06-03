# NexusRDM

Self-hosted Remote Device Management. One Docker container, zero external services.
Uses Turso (free hosted SQLite) -- your data persists forever across restarts and redeploys automatically.

---

## How it works

- Turso is free hosted SQLite. Sign up takes 2 minutes.
- Set 2 env vars (TURSO_URL + TURSO_TOKEN) in your hosting platform.
- Deploy the Dockerfile anywhere. Data survives restarts, redeploys, everything.
- No volumes to attach. No disk to configure. No Postgres to manage.

---

## Setup: Turso database (2 minutes, free)

Option A -- Turso web dashboard (no CLI):
  1. Go to https://app.turso.tech and sign up (free)
  2. Create a new database, name it: nexusrdm
  3. Copy the Database URL  (looks like: libsql://nexusrdm-yourname.turso.io)
  4. Go to Tokens tab, create a token, copy it

Option B -- Turso CLI:
  npm install -g @turso/cli
  turso auth login
  turso db create nexusrdm
  turso db show nexusrdm          (copy the URL)
  turso db tokens create nexusrdm (copy the token)

---

## Deploy to Render (recommended)

1. New Web Service -- connect your GitHub repo -- Runtime: Docker
2. Set these environment variables:
     TURSO_URL             = libsql://nexusrdm-yourname.turso.io
     TURSO_TOKEN           = your-token
     JWT_SECRET            = (openssl rand -hex 64)
     JWT_REFRESH_SECRET    = (openssl rand -hex 64)
     ENCRYPTION_KEY        = (openssl rand -hex 32)
     NODE_ENV              = production
3. Deploy. Done. No disk, no database addon needed.

## Deploy to Railway

Same env vars as above. Add them under Variables. Deploy.

## Deploy to Fly.io

  fly launch
  fly secrets set TURSO_URL=... TURSO_TOKEN=... JWT_SECRET=... JWT_REFRESH_SECRET=... ENCRYPTION_KEY=...
  fly deploy

## Local development

  cp .env.example .env
  # Leave TURSO_URL and TURSO_TOKEN empty -- uses local nexusrdm.db file
  # Fill in JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
  docker compose up -d
  # Panel: http://localhost:4000

---

## First run

1. Open the panel at your URL
2. Click "First run? Create admin account"
3. Enter name, email, password (min 12 chars)
4. Sign in
5. Recommended: enable 2FA in settings

Registration closes permanently after the first account is created.

---

## Build the Windows agent

Each .exe has the server URL, device key, and settings baked in at compile time.

Prerequisites on your Windows build machine:
  - Python 3.8+ (python.org)
  - Internet access for pip

Steps:
  1. In the panel: Devices -> Register Device -> copy the API key shown once
  2. On your Windows machine: cd agent && build.bat
  3. Answer 6 prompts (URL, key, name, interval, admin, silent)
  4. Output: agent\dist\nexus-agent-devicename.exe
  5. Copy .exe to target machine and run it
  6. Device appears online in panel within one interval

---

## Environment variables

  TURSO_URL             Turso database URL      libsql://name.turso.io
  TURSO_TOKEN           Turso auth token        from turso db tokens create
  JWT_SECRET            Access token key        openssl rand -hex 64
  JWT_REFRESH_SECRET    Refresh token key       openssl rand -hex 64
  ENCRYPTION_KEY        AES-256 key for 2FA     openssl rand -hex 32
  NODE_ENV              production
  PORT                  4000 (platform sets this)
  TOTP_ISSUER           NexusRDM (optional, cosmetic)

---

## Security

  Passwords       Argon2id, 64MB memory cost
  Access tokens   JWT HS256, 15 min expiry
  Refresh tokens  Rotated on every use, stored as SHA-256 hash
  2FA             TOTP RFC 6238, Google Authenticator compatible
  2FA secrets     AES-256-GCM encrypted at rest
  Device keys     SHA-256 hashed, shown once only
  Brute force     Lockout after 5 failures (30 min)
  Rate limits     Login 10/15min, TOTP 5/5min, API 120/min
  Audit log       Every action logged with user, IP, timestamp
  TLS             Platform proxy handles it, zero config
