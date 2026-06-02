# ─── Stage 1: Build React client ─────────────────────────────────────────────
FROM node:20-alpine AS client-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# ─── Stage 2: Build server (compiles better-sqlite3 native module) ────────────
FROM node:20-alpine AS server-builder

# Required to compile better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

WORKDIR /build/server
COPY server/package*.json ./
RUN npm install --omit=dev

# ─── Stage 3: Final runtime image ─────────────────────────────────────────────
FROM node:20-alpine

# better-sqlite3 needs these at runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

COPY server/src              ./src
COPY server/package*.json    ./
COPY --from=server-builder   /build/server/node_modules ./node_modules
COPY --from=client-builder   /build/client/dist         ./public

# Persistent data directory — mount a volume here in production
# e.g. Render: add a Disk at /data
# e.g. Docker: -v nexus_data:/data
RUN mkdir -p /data

# Non-root user — must own /data to write the SQLite file
RUN addgroup -S nexus && adduser -S nexus -G nexus && chown -R nexus:nexus /data /app
USER nexus

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
