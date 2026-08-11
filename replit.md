# Vault — Self-Hosted File Backup

A Dropbox-style file backup web app designed to run as a Docker container on Unraid home servers. Multi-user with admin management, drag-and-drop uploads, folder support, and inline file preview.

## Run & Operate

- `pnpm --filter @workspace/vault run dev` — run the frontend (Vite, port assigned by artifact)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — session signing secret (already set as Replit secret)
- Optional env: `UPLOAD_DIR` — path to store uploaded files (default: `./data/uploads`; use a volume mount on Unraid)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + wouter
- API: Express 5 + express-session + bcryptjs + multer
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (v3), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/users.ts` — users table
- `lib/db/src/schema/files.ts` — files/folders table (virtual filesystem)
- `artifacts/api-server/src/routes/auth.ts` — login, register, logout, me
- `artifacts/api-server/src/routes/files.ts` — file browser, upload, download, preview
- `artifacts/api-server/src/routes/users.ts` — admin user management
- `artifacts/vault/src/` — React frontend

## Architecture decisions

- **Virtual filesystem in DB, flat storage on disk**: Files are stored as `<UPLOAD_DIR>/<userId>/<uuid>.<ext>` on disk. The virtual path hierarchy (folders, filenames) lives entirely in PostgreSQL.
- **Session-based auth with bcrypt**: No JWT. `express-session` with a secure cookie (7-day). bcryptjs for password hashing (12 rounds). First registered user becomes admin.
- **File upload via raw fetch/FormData**: Multer handles multipart. Generated `useUploadFiles` hook is not used — the frontend uses raw fetch to track upload progress and pass `relativePaths` for folder uploads.
- **Preview/download via direct URL**: `/api/files/:id/preview` and `/api/files/:id/download` are streaming endpoints — session cookie is sent automatically by the browser for same-origin requests.

## Product

- **Login page** with "Create Account" link
- **File browser** — breadcrumb navigation, grid/list view, drag-and-drop + click upload, folder uploads, New Folder, file preview modal, download
- **Admin panel** — list users, create user, delete user, reset password
- **Storage stats** — per-user file count, folder count, total size

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Set `UPLOAD_DIR` to a Docker volume path (e.g. `/mnt/user/appdata/vault/uploads`) on Unraid
- After OpenAPI spec changes, always run codegen before writing route handlers
- Run `pnpm run typecheck:libs` after any `lib/*` change to refresh declarations before checking artifacts
- The `SESSION_SECRET` must be set — the server throws on startup if missing

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
