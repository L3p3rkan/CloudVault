import { Router, type IRouter } from "express";
import { stat, createReadStream } from "node:fs";
import { promisify } from "node:util";
import { db, filesTable, shareTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
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

  const tokens = await db
    .select()
    .from(shareTokensTable)
    .where(and(eq(shareTokensTable.fileId, id), eq(shareTokensTable.userId, userId)));

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

// GET /share/:token — public download (no auth)
router.get("/share/:token", async (req, res): Promise<void> => {
  const params = DownloadSharedFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  const { token } = params.data;

  const [shareToken] = await db
    .select()
    .from(shareTokensTable)
    .where(eq(shareTokensTable.token, token));

  if (!shareToken) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }

  // Check expiry
  if (shareToken.expiresAt && shareToken.expiresAt < new Date()) {
    res.status(410).json({ error: "Share link has expired" });
    return;
  }

  const [file] = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.id, shareToken.fileId));

  if (!file || !file.diskPath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    await statAsync(file.diskPath);
  } catch {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

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

  createReadStream(file.diskPath).pipe(res);
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
