import { Router, type IRouter } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { db, filesTable } from "@workspace/db";
import { eq, and, desc, sum, count, sql } from "drizzle-orm";
import {
  ListFilesQueryParams,
  CreateFolderBody,
  GetRecentFilesQueryParams,
  DeleteFileParams,
  GetFileMetaParams,
  ListFilesResponse,
  CreateFolderResponse,
  GetStorageStatsResponse,
  GetRecentFilesResponse,
  UploadFilesResponse,
  GetFileMetaResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");

// Multer storage: flat files on disk, virtual hierarchy in DB
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const userId = req.session.userId!;
    const dir = path.join(UPLOAD_DIR, String(userId));
    await mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 * 1024 }, // 100 GB per file
});

// Ensure a virtual folder path exists in DB (creates all intermediates)
async function ensureVirtualFolder(
  userId: number,
  folderPath: string,
): Promise<void> {
  if (folderPath === "/") return;

  const existing = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.userId, userId),
        eq(filesTable.path, folderPath),
        eq(filesTable.isFolder, true),
      ),
    );

  if (existing.length > 0) return;

  const parts = folderPath.split("/").filter(Boolean);
  const name = parts[parts.length - 1];
  const parentPath =
    parts.length === 1 ? "/" : "/" + parts.slice(0, -1).join("/");

  await ensureVirtualFolder(userId, parentPath);

  await db
    .insert(filesTable)
    .values({
      userId,
      name,
      path: folderPath,
      parentPath,
      size: 0,
      isFolder: true,
      diskPath: null,
    })
    .onConflictDoNothing();
}

const router: IRouter = Router();

// GET /files?path=/
router.get("/files", requireAuth, async (req, res): Promise<void> => {
  const queryParsed = ListFilesQueryParams.safeParse(req.query);
  const dirPath =
    queryParsed.success && queryParsed.data.path ? queryParsed.data.path : "/";

  const files = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.userId, req.session.userId!),
        eq(filesTable.parentPath, dirPath),
      ),
    )
    .orderBy(desc(filesTable.isFolder), filesTable.name);

  const result = files.map((f) => ({
    id: f.id,
    userId: f.userId,
    name: f.name,
    path: f.path,
    size: f.size ?? 0,
    mimeType: f.mimeType,
    isFolder: f.isFolder,
    parentPath: f.parentPath,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }));

  res.json(ListFilesResponse.parse(result));
});

// POST /files/folder
router.post("/files/folder", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateFolderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, parentPath } = parsed.data;
  const userId = req.session.userId!;

  // Sanitize folder name
  if (name.includes("/") || name === "." || name === "..") {
    res.status(400).json({ error: "Invalid folder name" });
    return;
  }

  const normalizedParent = parentPath || "/";
  const folderPath =
    normalizedParent === "/" ? `/${name}` : `${normalizedParent}/${name}`;

  // Check if already exists
  const [existing] = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.userId, userId),
        eq(filesTable.path, folderPath),
        eq(filesTable.isFolder, true),
      ),
    );

  if (existing) {
    res.status(400).json({ error: "Folder already exists" });
    return;
  }

  const [folder] = await db
    .insert(filesTable)
    .values({
      userId,
      name,
      path: folderPath,
      parentPath: normalizedParent,
      size: 0,
      isFolder: true,
      diskPath: null,
    })
    .returning();

  res.status(201).json(
    CreateFolderResponse.parse({
      id: folder.id,
      userId: folder.userId,
      name: folder.name,
      path: folder.path,
      size: folder.size ?? 0,
      mimeType: folder.mimeType,
      isFolder: folder.isFolder,
      parentPath: folder.parentPath,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    }),
  );
});

// GET /files/stats
router.get("/files/stats", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const [fileStats] = await db
    .select({
      totalFiles: count(),
      totalSize: sum(filesTable.size),
    })
    .from(filesTable)
    .where(and(eq(filesTable.userId, userId), eq(filesTable.isFolder, false)));

  const [folderStats] = await db
    .select({ totalFolders: count() })
    .from(filesTable)
    .where(and(eq(filesTable.userId, userId), eq(filesTable.isFolder, true)));

  const totalSize = Number(fileStats?.totalSize ?? 0);
  const totalFiles = Number(fileStats?.totalFiles ?? 0);
  const totalFolders = Number(folderStats?.totalFolders ?? 0);

  const usedFormatted = formatBytes(totalSize);

  res.json(
    GetStorageStatsResponse.parse({
      totalFiles,
      totalFolders,
      totalSize,
      usedFormatted,
    }),
  );
});

// GET /files/recent
router.get("/files/recent", requireAuth, async (req, res): Promise<void> => {
  const queryParsed = GetRecentFilesQueryParams.safeParse(req.query);
  const limit =
    queryParsed.success && queryParsed.data.limit ? queryParsed.data.limit : 20;

  const files = await db
    .select()
    .from(filesTable)
    .where(
      and(eq(filesTable.userId, req.session.userId!), eq(filesTable.isFolder, false)),
    )
    .orderBy(desc(filesTable.createdAt))
    .limit(limit);

  const result = files.map((f) => ({
    id: f.id,
    userId: f.userId,
    name: f.name,
    path: f.path,
    size: f.size ?? 0,
    mimeType: f.mimeType,
    isFolder: f.isFolder,
    parentPath: f.parentPath,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  }));

  res.json(GetRecentFilesResponse.parse(result));
});

// POST /files/upload  (multipart/form-data)
router.post(
  "/files/upload",
  requireAuth,
  upload.array("files"),
  async (req, res): Promise<void> => {
    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ error: "No files provided" });
      return;
    }

    const parentPath = (req.body.parentPath as string) || "/";
    let relativePaths: string[] = [];
    try {
      relativePaths = req.body.relativePaths
        ? JSON.parse(req.body.relativePaths)
        : [];
    } catch {
      relativePaths = [];
    }

    const userId = req.session.userId!;
    const inserted = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      const relativePath = relativePaths[i] || "";

      let virtualParentPath = parentPath;

      if (relativePath) {
        // relativePath is e.g. "photos/2024/beach.jpg"
        const parts = relativePath.split("/").filter(Boolean);
        parts.pop(); // remove filename

        if (parts.length > 0) {
          // Build intermediate folder paths and ensure they exist
          const segments = [];
          for (const part of parts) {
            segments.push(part);
            const folderVirtualPath =
              parentPath === "/"
                ? `/${segments.join("/")}`
                : `${parentPath}/${segments.join("/")}`;
            await ensureVirtualFolder(userId, folderVirtualPath);
          }

          virtualParentPath =
            parentPath === "/"
              ? `/${parts.join("/")}`
              : `${parentPath}/${parts.join("/")}`;
        }
      }

      const virtualPath =
        virtualParentPath === "/"
          ? `/${file.originalname}`
          : `${virtualParentPath}/${file.originalname}`;

      const [record] = await db
        .insert(filesTable)
        .values({
          userId,
          name: file.originalname,
          path: virtualPath,
          parentPath: virtualParentPath,
          size: file.size,
          mimeType: file.mimetype,
          isFolder: false,
          diskPath: file.path,
        })
        .returning();

      inserted.push({
        id: record.id,
        userId: record.userId,
        name: record.name,
        path: record.path,
        size: record.size ?? 0,
        mimeType: record.mimeType,
        isFolder: record.isFolder,
        parentPath: record.parentPath,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      });
    }

    res.status(201).json(UploadFilesResponse.parse(inserted));
  },
);

// PATCH /files/:id — move a file or folder to a new parent path
router.patch("/files/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { newParentPath } = req.body as { newParentPath?: string };
  if (!newParentPath || typeof newParentPath !== "string") {
    res.status(400).json({ error: "newParentPath is required" });
    return;
  }

  const userId = req.session.userId!;

  const [item] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)));

  if (!item) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (item.parentPath === newParentPath) {
    res.status(400).json({ error: "Item is already in that folder" });
    return;
  }

  // Prevent moving a folder into itself or its own descendants
  if (
    item.isFolder &&
    (newParentPath === item.path || newParentPath.startsWith(item.path + "/"))
  ) {
    res.status(400).json({ error: "Cannot move a folder into itself" });
    return;
  }

  const newPath =
    newParentPath === "/" ? `/${item.name}` : `${newParentPath}/${item.name}`;

  // Collision check
  const [collision] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.userId, userId), eq(filesTable.path, newPath)));

  if (collision) {
    res.status(409).json({ error: "An item already exists at that location" });
    return;
  }

  // For folders: rewrite paths of all descendants
  if (item.isFolder) {
    const oldPrefix = item.path + "/";
    const newPrefix = newPath + "/";

    const children = await db
      .select()
      .from(filesTable)
      .where(
        and(
          eq(filesTable.userId, userId),
          sql`${filesTable.path} LIKE ${oldPrefix + "%"}`,
        ),
      );

    for (const child of children) {
      const childNewPath = newPrefix + child.path.substring(oldPrefix.length);
      const lastSlash = childNewPath.lastIndexOf("/");
      const childNewParent = lastSlash <= 0 ? "/" : childNewPath.substring(0, lastSlash);
      await db
        .update(filesTable)
        .set({ path: childNewPath, parentPath: childNewParent })
        .where(eq(filesTable.id, child.id));
    }
  }

  const [updated] = await db
    .update(filesTable)
    .set({ path: newPath, parentPath: newParentPath, updatedAt: new Date() })
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)))
    .returning();

  res.json({
    id: updated.id,
    userId: updated.userId,
    name: updated.name,
    path: updated.path,
    size: updated.size ?? 0,
    mimeType: updated.mimeType,
    isFolder: updated.isFolder,
    parentPath: updated.parentPath,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

// DELETE /files/:id
router.delete("/files/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = req.session.userId!;
  const { id } = params.data;

  const [target] = await db
    .select()
    .from(filesTable)
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)));

  if (!target) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  if (target.isFolder) {
    // Recursively find all files under this folder
    const children = await db
      .select()
      .from(filesTable)
      .where(
        and(
          eq(filesTable.userId, userId),
          sql`${filesTable.path} LIKE ${target.path + "/%"}`,
        ),
      );

    // Delete physical files
    for (const child of children) {
      if (!child.isFolder && child.diskPath) {
        await unlink(child.diskPath).catch(() => {});
      }
    }

    // Delete all children from DB
    await db
      .delete(filesTable)
      .where(
        and(
          eq(filesTable.userId, userId),
          sql`${filesTable.path} LIKE ${target.path + "/%"}`,
        ),
      );
  } else if (target.diskPath) {
    // Delete physical file
    await unlink(target.diskPath).catch(() => {});
  }

  // Delete the record itself
  await db
    .delete(filesTable)
    .where(and(eq(filesTable.id, id), eq(filesTable.userId, userId)));

  res.status(204).send();
});

// GET /files/:id/meta
router.get("/files/:id/meta", requireAuth, async (req, res): Promise<void> => {
  const params = GetFileMetaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [file] = await db
    .select()
    .from(filesTable)
    .where(
      and(
        eq(filesTable.id, params.data.id),
        eq(filesTable.userId, req.session.userId!),
      ),
    );

  if (!file) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.json(
    GetFileMetaResponse.parse({
      id: file.id,
      userId: file.userId,
      name: file.name,
      path: file.path,
      size: file.size ?? 0,
      mimeType: file.mimeType,
      isFolder: file.isFolder,
      parentPath: file.parentPath,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    }),
  );
});

// GET /files/:id/download
router.get(
  "/files/:id/download",
  requireAuth,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [file] = await db
      .select()
      .from(filesTable)
      .where(
        and(eq(filesTable.id, id), eq(filesTable.userId, req.session.userId!)),
      );

    if (!file || !file.diskPath) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    await stat(file.diskPath).catch(() => {
      res.status(404).json({ error: "File not found on disk" });
      return;
    });

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
  },
);

// GET /files/:id/preview
router.get(
  "/files/:id/preview",
  requireAuth,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [file] = await db
      .select()
      .from(filesTable)
      .where(
        and(eq(filesTable.id, id), eq(filesTable.userId, req.session.userId!)),
      );

    if (!file || !file.diskPath) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    if (file.mimeType) {
      res.setHeader("Content-Type", file.mimeType);
    }
    // Inline display (for preview)
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.name)}"`,
    );
    if (file.size) {
      res.setHeader("Content-Length", file.size.toString());
    }

    createReadStream(file.diskPath).pipe(res);
  },
);

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default router;
