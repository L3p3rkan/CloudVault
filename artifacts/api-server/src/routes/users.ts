import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, filesTable } from "@workspace/db";
import { eq, sum, sql } from "drizzle-orm";
import {
  CreateUserBody,
  ChangeUserPasswordBody,
  ChangeUserPasswordParams,
  DeleteUserParams,
  ListUsersResponse,
  CreateUserResponse,
} from "@workspace/api-zod";
import { requireAdmin, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /users — admin only
router.get("/users", requireAdmin, async (req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);

  // Compute storage used per user
  const storageSums = await db
    .select({
      userId: filesTable.userId,
      total: sum(filesTable.size),
    })
    .from(filesTable)
    .groupBy(filesTable.userId);

  const storageMap = new Map<number, number>();
  for (const row of storageSums) {
    storageMap.set(row.userId, Number(row.total ?? 0));
  }

  const result = users.map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    isAdmin: u.isAdmin,
    storageUsed: storageMap.get(u.id) ?? 0,
    createdAt: u.createdAt.toISOString(),
  }));

  res.json(ListUsersResponse.parse(result));
});

// POST /users — admin only
router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, email, password, isAdmin } = parsed.data;

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      email: email ?? null,
      passwordHash,
      isAdmin: isAdmin ?? false,
    })
    .returning();

  res.status(201).json(
    CreateUserResponse.parse({
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      storageUsed: 0,
      createdAt: user.createdAt.toISOString(),
    }),
  );
});

// DELETE /users/:id — admin only
router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { id } = params.data;

  // Prevent deleting yourself
  if (id === req.session.userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  // Get all disk files for this user before deleting
  const userFiles = await db
    .select({ diskPath: filesTable.diskPath })
    .from(filesTable)
    .where(eq(filesTable.userId, id));

  // Delete physical files
  const { unlink } = await import("node:fs/promises");
  for (const f of userFiles) {
    if (f.diskPath) {
      await unlink(f.diskPath).catch(() => {});
    }
  }

  // Delete the user (cascade deletes files records)
  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.status(204).send();
});

// PATCH /users/:id/password — admin can change any; user can change own
router.patch(
  "/users/:id/password",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ChangeUserPasswordParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const { id } = params.data;

    // Only admin or the user themselves
    const [requestingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!));

    if (!requestingUser) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!requestingUser.isAdmin && requestingUser.id !== id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const parsed = ChangeUserPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(204).send();
  },
);

export default router;
