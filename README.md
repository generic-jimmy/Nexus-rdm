# NexusRDM

Self-hosted Remote Device Management — web panel + Windows agent.  
**SQLite database** — zero external dependencies. One container, one file, works everywhere.

---

## Architecture

```
[ Any hosting platform ]
  └── One Docker container
        ├── Express API      →  /api/*
        ├── WebSocket hub    →  /ws
        ├── React panel      →  /* (static, same-origin)
        └── SQLite DB        →  /data/nexusrdm.db (persistent volume)

[ Windows devices ]
  └── nexus-agent-<name>.exe
        └── HTTPS heartbeat every N seconds  →  server
```

No external database. No connection strings. No managed services.  
TLS is handled by the platform proxy — your container runs plain HTTP internally.

---

## Quick Start — Local

```bash
git clone https://github.com/you/nexus-rdm
cd nexus-rdm
cp .env.example .env
# Edit .env — fill in the 3 secrets (see below)
docker compose up -d
# Panel: http://localhost:4000
```

---

## Deploy to any platform

Single `Dockerfile`. Point any container platform at it and set 3 env vars.

### Render
1. New → Web Service → connect repo → Runtime: **Docker**
2. Set environment variables (see below)
3. Add a **Disk** → Mount Path: `/data` → Size: 1 GB (free tier)
4. Deploy → done

### Railway
1. New Project → Deploy from GitHub
2. Set environment variables
3. Add a **Volume** → Mount Path: `/data`
4. Deploy → done

### Fly.io
```bash
fly launch
fly volumes create nexus_data --size 1
# Edit fly.toml: add [mounts] source="nexus_data" destination="/data"
fly secrets set JWT_SECRET=... JWT_REFRESH_SECRET=... ENCRYPTION_KEY=...
fly deploy
```

### DigitalOcean / any VPS
```bash
git clone https://github.com/you/nexus-rdm
cd nexus-rdm && cp .env.example .env && nano .env
docker compose up -d
```

---

## Environment Variables

Only **3 secrets** to generate. Everything else has safe defaults.

| Variable             | Description                          | How to generate         |
|----------------------|--------------------------------------|-------------------------|
| `JWT_SECRET`         | Access token signing key             | `openssl rand -hex 64`  |
| `JWT_REFRESH_SECRET` | Refresh token signing key            | `openssl rand -hex 64`  |
| `ENCRYPTION_KEY`     | AES-256 key for 2FA secrets at rest  | `openssl rand -hex 32`  |
| `DB_DIR`             | SQLite file directory (default /data)| Usually leave as `/data`|
| `NODE_ENV`           | Set to `production`                  | —                       |
| `PORT`               | Server port (default 4000)           | Usually set by platform |

---

## Persistent Storage

The SQLite database file lives at `/data/nexusrdm.db`.  
**You must mount a persistent volume at `/data`** — otherwise data resets on redeploy.

| Platform     | How to add persistent storage               |
|--------------|---------------------------------------------|
| Render       | Service → Disks → Mount at `/data`          |
| Railway      | Service → Volumes → Mount at `/data`        |
| Fly.io       | `fly volumes create` + `[mounts]` in fly.toml |
| Docker local | Volume is in `docker-compose.yml` already   |
| VPS          | Volume is in `docker-compose.yml` already   |

---

## First-Run Setup

1. Open the panel at your URL
2. Click **"First run? Create admin account"**
3. Enter name, email, password (min 12 chars)
4. Sign in → enable 2FA in settings (recommended)

Registration is permanently disabled after the first account is created.

---

## Building the Windows Agent

Each `.exe` is unique — server URL, device key, name, interval, and flags baked in.

**On your local Windows machine:**

```
cd agent
build.bat
```

Follow the 6 prompts:
```
[1/6] Server URL     → https://your-app.onrender.com
[2/6] Device API key → nrdm_xxxx  (get from panel → Register Device)
[3/6] Device name    → office-pc-01
[4/6] Interval       → 30  (seconds)
[5/6] Admin          → y
[6/6] Silent         → y
```

Output: `agent/dist/nexus-agent-office-pc-01.exe`  
Copy to target machine and run. Device appears online within one interval.

---

## Security

| Layer                | Implementation                                        |
|----------------------|-------------------------------------------------------|
| Password hashing     | Argon2id — 64 MB memory, 3 iterations                |
| Access tokens        | JWT HS256, 15-minute expiry                           |
| Refresh tokens       | Rotated on every use, stored as SHA-256 hash          |
| 2FA                  | TOTP RFC 6238, Google Authenticator compatible        |
| 2FA secrets at rest  | AES-256-GCM encrypted in SQLite                      |
| Device API keys      | SHA-256 hashed, raw key shown once only               |
| Brute force          | Account lock after 5 failures (30 min)                |
| Rate limiting        | Login: 10/15min · TOTP: 5/5min · API: 120/min        |
| Audit log            | Every action logged with user, IP, timestamp          |
| TLS                  | Platform proxy → plain HTTP inside container          |

---

## Project Structure

```
nexus-rdm/
├── Dockerfile                   ← multi-stage build
├── docker-compose.yml           ← local dev (no external DB needed)
├── .env.example
│
├── server/src/
│   ├── index.js                 ← Express + WebSocket
│   ├── config/db.js             ← SQLite init + schema (runs on startup)
│   ├── utils/auth.js            ← Argon2, JWT, TOTP, AES-GCM
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── rateLimiter.js
│   │   └── audit.js
│   └── routes/
│       ├── auth.js
│       └── devices.js
│
├── client/src/
│   ├── pages/Login.jsx
│   ├── pages/Dashboard.jsx
│   ├── store/auth.js
│   └── utils/api.js
│
└── agent/
    ├── agent.py
    ├── build.bat
    └── requirements.txt
```
