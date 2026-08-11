# ============================================================
# Vault — Multi-stage Dockerfile
# Produces a single lean image that serves both the React
# frontend (as static files) and the Express API.
# ============================================================

# ------------------------------------------------------------
# Stage 1: install all workspace dependencies
# ------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable

WORKDIR /app

# Copy manifests first so layer is cached until deps change
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json             ./lib/db/
COPY lib/api-spec/package.json       ./lib/api-spec/
COPY lib/api-zod/package.json        ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/vault/package.json    ./artifacts/vault/

# Explicitly allow the lifecycle scripts that onlyBuiltDependencies already
# permits in pnpm-workspace.yaml.  Listing them again here ensures the Docker
# build environment picks them up even when pnpm falls back to .npmrc only.
RUN printf '\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=unrs-resolver\n' >> .npmrc

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

# Run as an unprivileged user — important for a file-upload service
# with host-mounted storage.  The uploads volume must be owned (or
# group-writable) by UID 1001 on the host side; on Unraid you can
# do this once with:
#   chown -R 1001:1001 /mnt/user/appdata/vault/uploads
RUN addgroup -S vault && adduser -S -G vault -u 1001 vault

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public

# Copy the esbuild bundle (includes all node_modules)
COPY --from=build-api      /app/artifacts/api-server/dist ./dist

# Copy built frontend static files
COPY --from=build-frontend /app/artifacts/vault/dist/public ./public

# Give the app user ownership of the working directory.
# The uploads volume is mounted at runtime; the entrypoint will
# inherit whatever ownership the host sets on that path.
RUN chown -R vault:vault /app

USER vault

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/healthz || exit 1

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
