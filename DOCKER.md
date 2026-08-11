# Running Vault on Unraid (and anywhere with Docker)

Vault ships as a single Docker image that serves both the React frontend and the
Express API. A PostgreSQL container handles the database.

---

## Environment variables

| Variable          | Required | Default              | Description |
|-------------------|----------|----------------------|-------------|
| `SESSION_SECRET`  | ✅ yes   | —                    | Secret used to sign session cookies. Generate with `openssl rand -hex 32`. |
| `DATABASE_URL`    | ✅ yes   | —                    | PostgreSQL connection string, e.g. `postgresql://vault:pass@db:5432/vault`. |
| `PORT`            | ✅ yes   | `3000`               | Port the HTTP server listens on inside the container. |
| `UPLOAD_DIR`      | optional | `./data/uploads`     | Filesystem path where uploaded files are stored. Set to a Docker volume or bind-mount path. |
| `NODE_ENV`        | optional | `production`         | Node environment. Leave as `production`. |

---

## Option A — Unraid Community Applications (recommended)

1. **Install the Community Applications plugin** if you haven't already
   (Unraid → Apps → Install Community Applications).

2. **Add the template**:
   - In Community Applications, click **"Add Container"**.
   - Switch to the **Template URL** tab and paste the raw URL of
     `unraid-template.xml` from this repository.

3. **Fill in the required fields** shown in the form:
   - **SESSION_SECRET** — generate a random string:
     ```
     openssl rand -hex 32
     ```
   - **DATABASE_URL** — connection string pointing at your PostgreSQL
     container (see step 4 below).
   - **Uploads Directory** — a path on a Unraid User Share, e.g.
     `/mnt/user/appdata/vault/uploads`.

4. **Add a PostgreSQL container** (if you don't already have one):
   - Search for `postgres` in Community Applications and install it.
   - Set the database name to `vault`, pick a user and password, and note
     the container name — you'll need it for `DATABASE_URL`.
   - Example `DATABASE_URL`: `postgresql://vault:yourpassword@postgresql:5432/vault`

5. **Set upload directory ownership** so the container's unprivileged user
   (UID 1001) can write uploaded files:
   ```bash
   chown -R 1001:1001 /mnt/user/appdata/vault/uploads
   ```

6. **Start** the Vault container.

7. **Apply the database schema** (one-time, from a machine that has the repo cloned):
   ```bash
   DATABASE_URL="postgresql://vault:yourpassword@[UNRAID-IP]:5432/vault" \
     pnpm --filter @workspace/db run push
   ```
   > The bundled Docker image does not include Drizzle CLI — you run the schema
   > push from the cloned repository on any machine that can reach the PostgreSQL
   > port (5432 is exposed by the db container). Automatic first-boot migration
   > is tracked as a follow-up improvement.

8. Open the web UI at `http://[YOUR-UNRAID-IP]:3000`.
   - **Register an account** — the first registered account becomes the admin.

---

## Option B — docker compose (any host)

```bash
# 1. Clone the repo
git clone https://github.com/your-org/vault.git
cd vault

# 2. Create your .env from the example
cp .env.example .env
#    → Edit .env: set SESSION_SECRET (required) and optionally UPLOAD_DIR / HOST_PORT

# 3. Build and start (the db container port 5432 is exposed for the next step)
docker compose up -d --build

# 4. Apply the database schema (one-time)
#    The production image does not include Drizzle CLI, so run this from the repo:
DATABASE_URL="postgresql://vault:vaultpass@localhost:5432/vault" \
  pnpm --filter @workspace/db run push

# 5. Open the UI
open http://localhost:3000
```

The first account you register becomes the admin.

---

## Option C — build the image yourself

```bash
# Build
docker build -t vault:latest .

# Run (with an external PostgreSQL)
docker run -d \
  --name vault \
  -p 3000:3000 \
  -v /mnt/user/appdata/vault/uploads:/data/uploads \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DATABASE_URL="postgresql://vault:pass@db-host:5432/vault" \
  -e UPLOAD_DIR="/data/uploads" \
  -e PORT=3000 \
  vault:latest
```

---

## Upgrading

```bash
# docker compose
docker compose pull
docker compose up -d

# Unraid
# Click the container → "Update" in the Docker tab.
```

**Schema changes** are not applied automatically on upgrade. If the new version
includes schema changes, run the schema push from the cloned repo before
restarting the container:

```bash
DATABASE_URL="postgresql://vault:yourpassword@localhost:5432/vault" \
  pnpm --filter @workspace/db run push
```

---

## Volumes / data locations

| Purpose          | Default container path | Recommended Unraid path |
|------------------|------------------------|-------------------------|
| Uploaded files   | `/data/uploads`        | `/mnt/user/appdata/vault/uploads` |
| PostgreSQL data  | `/var/lib/postgresql/data` (in the `db` container) | managed by the PostgreSQL container |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Container exits immediately | Missing `SESSION_SECRET` or `DATABASE_URL` | Check env vars |
| Can't connect to database | Wrong `DATABASE_URL` or db not ready | Verify container name/IP and that postgres is running |
| Uploads fail | `UPLOAD_DIR` not writable | `chmod 777` the host bind-mount directory or check ownership |
| White screen / 404 | Wrong port mapping | Check the port in Unraid Docker tab |
