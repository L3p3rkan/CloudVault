import { Router, type IRouter, type Request, type Response } from "express";
import { stat, createReadStream } from "node:fs";
import { promisify } from "node:util";
import { db, filesTable, shareTokensTable } from "@workspace/db";
import { eq, and, or, isNull, gt, sql } from "drizzle-orm";
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

/**
 * Stream a file to the response, supporting HTTP Range requests (RFC 7233).
 * Sends 206 Partial Content when a valid Range header is present, otherwise 200.
 */
async function streamFile(
  req: Request,
  res: Response,
  filePath: string,
  fileSize: number | null,
  mimeType: string | null,
  disposition: string,
): Promise<void> {
  const totalSize = fileSize ?? (await statAsync(filePath)).size;

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", disposition);
  res.setHeader("Accept-Ranges", "bytes");
  if (mimeType) res.setHeader("Content-Type", mimeType);

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    // Parse "bytes=start-end"
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }

    const rawStart = match[1];
    const rawEnd = match[2];

    let start: number;
    let end: number;

    if (rawStart === "") {
      // suffix-range: bytes=-N  (last N bytes)
      const suffixLength = parseInt(rawEnd, 10);
      if (isNaN(suffixLength) || suffixLength <= 0) {
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        res.status(416).end();
        return;
      }
      start = Math.max(0, totalSize - suffixLength);
      end = totalSize - 1;
    } else {
      start = parseInt(rawStart, 10);
      // Per RFC 7233 §2.1: if end > last-byte-pos, clamp to last-byte-pos
      end = rawEnd === "" ? totalSize - 1 : Math.min(parseInt(rawEnd, 10), totalSize - 1);
    }

    // 416 only when: start is NaN/invalid, end is NaN, or start is beyond EOF
    if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      res.status(416).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Content-Length", chunkSize.toString());
    res.status(206);
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", totalSize.toString());
    res.status(200);
    createReadStream(filePath).pipe(res);
  }
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
    size: file.size ?? 0,
    mimeType: file.mimeType ?? null,
    expiresAt: shareToken.expiresAt?.toISOString() ?? null,
    isFolder: file.isFolder,
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

  if (!file) {
    return { ok: false, status: 404, error: "File not found" };
  }

  // For regular files, verify the file exists on disk
  if (!file.isFolder) {
    if (!file.diskPath) return { ok: false, status: 404, error: "File not found" };
    try {
      await statAsync(file.diskPath);
    } catch {
      return { ok: false, status: 404, error: "File not found on disk" };
    }
  }

  return { ok: true, file, shareToken };
}

// GET /share/:token/folder-files — list files inside a shared folder (no auth)
router.get("/share/:token/folder-files", async (req, res): Promise<void> => {
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

  const { file: folder } = result;
  if (!folder.isFolder) {
    res.status(400).json({ error: "This share link is for a file, not a folder" });
    return;
  }

  const children = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.userId, folder.userId),
        eq(filesTable.isFolder, false),
        sql`(${filesTable.path} LIKE ${folder.path + "/%"} OR ${filesTable.parentPath} = ${folder.path})`,
      ),
    );

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.json(
    children.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size ?? 0,
      mimeType: f.mimeType ?? null,
      path: f.path,
      parentPath: f.parentPath,
    })),
  );
});

// GET /share/:token/folder-file/:fileId — download a single file from a shared folder (no auth)
router.get("/share/:token/folder-file/:fileId", async (req, res): Promise<void> => {
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

  const { file: folder } = result;
  if (!folder.isFolder) {
    res.status(400).json({ error: "Not a folder share" });
    return;
  }

  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(fileId)) {
    res.status(400).json({ error: "Invalid fileId" });
    return;
  }

  const [targetFile] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, fileId), eq(filesTable.userId, folder.userId), eq(filesTable.isFolder, false)));

  if (!targetFile || !targetFile.diskPath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // Security: verify the file is actually inside the shared folder
  if (
    targetFile.parentPath !== folder.path &&
    !targetFile.path.startsWith(folder.path + "/")
  ) {
    res.status(403).json({ error: "File is not in the shared folder" });
    return;
  }

  try {
    await statAsync(targetFile.diskPath);
  } catch {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  await streamFile(
    req,
    res,
    targetFile.diskPath,
    targetFile.size ?? null,
    targetFile.mimeType ?? null,
    `attachment; filename="${encodeURIComponent(targetFile.name)}"`,
  );
});

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

  if (file.isFolder) {
    res.status(400).json({ error: "Use the folder-files API to browse shared folders" });
    return;
  }

  const safe = isInlineSafe(file.mimeType);
  const disposition = safe ? "inline" : "attachment";

  await streamFile(
    req,
    res,
    file.diskPath!,
    file.size ?? null,
    file.mimeType ?? null,
    `${disposition}; filename="${encodeURIComponent(file.name)}"`,
  );
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

  if (file.isFolder) {
    res.status(400).json({ error: "Use the folder-files API to browse shared folders" });
    return;
  }

  await streamFile(
    req,
    res,
    file.diskPath!,
    file.size ?? null,
    file.mimeType ?? null,
    `attachment; filename="${encodeURIComponent(file.name)}"`,
  );
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
