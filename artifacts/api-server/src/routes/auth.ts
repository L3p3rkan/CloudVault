import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import {
  LoginBody,
  RegisterBody,
  LoginResponse,
  RegisterResponse,
  GetMeResponse,
  ChangeMyPasswordBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!user) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  req.session.userId = user.id;

  // Wait for the session to be committed to the PostgreSQL store before
  // responding. Without this, the client's next request can arrive before the
  // row is written and be rejected as unauthenticated.
  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.json(
      LoginResponse.parse({
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
      }),
    );
  });
});

// POST /auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, email, password } = parsed.data;

  // Check username availability
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  // First user becomes admin
  const [{ value: userCount }] = await db
    .select({ value: count() })
    .from(usersTable);
  const isFirstUser = userCount === 0;

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      email: email ?? null,
      passwordHash,
      isAdmin: isFirstUser,
    })
    .returning();

  req.session.userId = user.id;

  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Session error" });
      return;
    }
    res.status(201).json(
      RegisterResponse.parse({
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
      }),
    );
  });
});

// POST /auth/logout
router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

// POST /auth/change-password
router.post(
  "/auth/change-password",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = ChangeMyPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.session.userId!));

    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, user.id));

    res.status(204).send();
  },
);

// GET /auth/me
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId!));

  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  res.json(
    GetMeResponse.parse({
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
    }),
  );
});

export default router;
