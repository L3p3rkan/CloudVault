# ============================================================
# Vault — Multi-stage Dockerfile
# Produces a single lean image that serves both the React
# frontend (as static files) and the Express API.
# ============================================================

# ------------------------------------------------------------
# Stage 1: install all workspace dependencies
# ------------------------------------------------------------
FROM node:24-alpine AS deps
# Pin pnpm explicitly — avoids corepack auto-downloading the wrong version.
RUN npm install -g pnpm@10.26.1

WORKDIR /app

# Copy manifests first so layer is cached until deps change
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json             ./lib/db/
COPY lib/api-spec/package.json       ./lib/api-spec/
COPY lib/api-zod/package.json        ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/vault/package.json    ./artifacts/vault/

RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------
# Stage 2: build the React frontend
# BASE_PATH=/ — assets are served from the container root.
# PORT is required by the vite config file at module load
# time (even during build), so we supply a dummy value.
# ------------------------------------------------------------
FROM deps AS build-frontend

COPY . .

ENV BASE_PATH=/ \
    PORT=3000 \
    NODE_ENV=production

RUN pnpm --filter @workspace/vault run build
# Output: artifacts/vault/dist/public/

# ------------------------------------------------------------
# Stage 3: build the Express API server (esbuild bundle)
# ------------------------------------------------------------
FROM deps AS build-api

COPY . .

RUN pnpm --filter @workspace/api-server run build
# Output: artifacts/api-server/dist/index.mjs  (+ pino workers)

# ------------------------------------------------------------
# Stage 4: lean production image
# ------------------------------------------------------------
FROM node:24-alpine AS production

# su-exec: tiny Alpine utility that switches UID/GID and exec's a process
# (similar to gosu but a single C file — no external deps).
# Used by entrypoint.sh to drop from root → vault after fixing volume ownership.
RUN apk add --no-cache su-exec

# Create the unprivileged vault user (UID 1001)
RUN addgroup -S vault && adduser -S -G vault -u 1001 vault

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public

# Copy the esbuild bundle (includes all node_modules)
COPY --from=build-api      /app/artifacts/api-server/dist ./dist

# Copy built frontend static files
COPY --from=build-frontend /app/artifacts/vault/dist/public ./public

# Copy the entrypoint script (runs as root, fixes volume permissions, drops to vault)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Pre-create the uploads directory owned by vault so fresh named volumes
# are initialised with the correct ownership by Docker.
RUN mkdir -p /data/uploads && chown vault:vault /data/uploads

# Give the app user ownership of /app itself.
RUN chown -R vault:vault /app

# NOTE: we do NOT switch to USER vault here.  The entrypoint.sh runs as root,
# calls chown on /data/uploads (fixes bind-mount or named-volume ownership),
# then exec's the Node process as vault via su-exec.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/healthz || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
