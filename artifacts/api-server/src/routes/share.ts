import { Router, type IRouter } from "express";
import { stat, createReadStream } from "node:fs";
import { promisify } from "node:util";
import { db, filesTable, shareTokensTable } from "@workspace/db";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import {
  CreateShareTokenParams,
  CreateShareTokenBody,
  CreateShareTokenResponse,
  ListShareTokensParams,
  ListShareTokensResponse,
  RevokeShareTokenParams,
  DownloadSharedFileParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const statAsync = promisify(stat);

const router: IRouter = Router();

// POST /files/:id/share — create a share token
router.post("/files/:id/share", requireAuth, async (req, res): Promise<void> => {
  const params = CreateShareTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateShareTokenBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const userId = req.session.userId!;
  const { id } = params.data;
  const { expiry } = body.data;

  // Verify the file belongs to the user and is not a folder
  const [file] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)));

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  if (file.isFolder) {
    res.status(400).json({ error: "Cannot share a folder" });
    return;
  }

  // Compute expiry timestamp
  let expiresAt: Date | null = null;
  const now = Date.now();
  if (expiry === "1h") expiresAt = new Date(now + 60 * 60 * 1000);
  else if (expiry === "24h") expiresAt = new Date(now + 24 * 60 * 60 * 1000);
  else if (expiry === "7d") expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
  // "never" => null

  const token = crypto.randomUUID();

  const [record] = await db
    .insert(shareTokensTable)
    .values({ token, fileId: id, userId, expiresAt })
    .returning();

  res.status(201).json(
    CreateShareTokenResponse.parse({
      id: record.id,
      token: record.token,
      fileId: record.fileId,
      userId: record.userId,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    }),
  );
});

// GET /files/:id/share — list share tokens for a file
router.get("/files/:id/share", requireAuth, async (req, res): Promise<void> => {
  const params = ListShareTokensParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = req.session.userId!;
  const { id } = params.data;

  // Verify the file belongs to the user
  const [file] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)));

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const now = new Date();
  const tokens = await db
    .select()
    .from(shareTokensTable)
    .where(
      and(
        eq(shareTokensTable.fileId, id),
        eq(shareTokensTable.userId, userId),
        or(isNull(shareTokensTable.expiresAt), gt(shareTokensTable.expiresAt, now)),
      ),
    );

  res.json(
    ListShareTokensResponse.parse(
      tokens.map((t) => ({
        id: t.id,
        token: t.token,
        fileId: t.fileId,
        userId: t.userId,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
    ),
  );
});

// MIME types safe to serve inline (no active content that could run scripts)
// Excludes: text/html, text/javascript, image/svg+xml, and all other active types
const INLINE_SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/tiff",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/flac",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-msvideo",
  "application/pdf",
  "text/plain",
]);

function isInlineSafe(mimeType: string | null): boolean {
  if (!mimeType) return false;
  const normalised = mimeType.toLowerCase().split(";")[0].trim();
  return INLINE_SAFE_MIME_TYPES.has(normalised);
}

// GET /share/:token/meta — public metadata (no auth)
router.get("/share/:token/meta", async (req, res): Promise<void> => {
  const params = DownloadSharedFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const result = await resolveShare(params.data.token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { file, shareToken } = result;
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.json({
    name: file.name,
    size: file.size,
    mimeType: file.mimeType ?? null,
    expiresAt: shareToken.expiresAt?.toISOString() ?? null,
  });
});

// Shared helper: resolve and validate a share token + file
async function resolveShare(
  token: string,
): Promise<
  | { ok: true; file: (typeof filesTable.$inferSelect); shareToken: (typeof shareTokensTable.$inferSelect) }
  | { ok: false; status: number; error: string }
> {
  const [shareToken] = await db
    .select()
    .from(shareTokensTable)
    .where(eq(shareTokensTable.token, token));

  if (!shareToken) {
    return { ok: false, status: 404, error: "Share link not found" };
  }

  if (shareToken.expiresAt && shareToken.expiresAt < new Date()) {
    return { ok: false, status: 410, error: "Share link has expired" };
  }

  const [file] = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.id, shareToken.fileId));

  if (!file || !file.diskPath) {
    return { ok: false, status: 404, error: "File not found" };
  }

  try {
    await statAsync(file.diskPath);
  } catch {
    return { ok: false, status: 404, error: "File not found on disk" };
  }

  return { ok: true, file, shareToken };
}

// GET /share/:token/inline — public inline preview (no auth)
// Only serves file content inline for a strict allowlist of safe MIME types.
// Active/script-capable types (HTML, SVG, JS, …) fall back to attachment
// so they cannot execute on the app's authenticated origin.
router.get("/share/:token/inline", async (req, res): Promise<void> => {
  const params = DownloadSharedFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const result = await resolveShare(params.data.token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { file } = result;
  const safe = isInlineSafe(file.mimeType);
  const disposition = safe ? "inline" : "attachment";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(file.name)}"`,
  );
  if (file.mimeType) {
    res.setHeader("Content-Type", file.mimeType);
  }
  if (file.size) {
    res.setHeader("Content-Length", file.size.toString());
  }

  createReadStream(file.diskPath!).pipe(res);
});

// GET /share/:token — public download (no auth)
router.get("/share/:token", async (req, res): Promise<void> => {
  const params = DownloadSharedFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const result = await resolveShare(params.data.token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const { file } = result;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${encodeURIComponent(file.name)}"`,
  );
  if (file.mimeType) {
    res.setHeader("Content-Type", file.mimeType);
  }
  if (file.size) {
    res.setHeader("Content-Length", file.size.toString());
  }

  createReadStream(file.diskPath!).pipe(res);
});

// DELETE /share/:token/revoke — revoke a share token
router.delete("/share/:token/revoke", requireAuth, async (req, res): Promise<void> => {
  const params = RevokeShareTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const userId = req.session.userId!;
  const { token } = params.data;

  const [shareToken] = await db
    .select()
    .from(shareTokensTable)
    .where(and(eq(shareTokensTable.token, token), eq(shareTokensTable.userId, userId)));

  if (!shareToken) {
    res.status(404).json({ error: "Share token not found" });
    return;
  }

  await db
    .delete(shareTokensTable)
    .where(eq(shareTokensTable.token, token));

  res.status(204).send();
});

export default router;
