import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import { randomUUID } from "node:crypto";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const PgSession = ConnectPgSimple(session);

// If SESSION_SECRET is not set, generate a random one for this process
// lifetime.  Sessions will be invalidated on every container restart, but the
// app will still work — which is far better than crashing on first boot.
// Set SESSION_SECRET in your docker-compose.yml / Unraid template to persist
// sessions across restarts.
if (!process.env.SESSION_SECRET) {
  const generated = randomUUID();
  process.env.SESSION_SECRET = generated;
  logger.warn(
    "SESSION_SECRET is not set — using a randomly generated secret. " +
      "All sessions will be invalidated on container restart. " +
      "Set SESSION_SECRET in your environment to avoid this.",
  );
}

const app: Express = express();

// Trust the first hop proxy (Replit's reverse proxy, nginx, etc.) so that
// req.secure is true when X-Forwarded-Proto: https is present.  Without this,
// express-session silently skips setting the cookie when secure:true and the
// connection appears to be plain HTTP.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(
  session({
    store: new PgSession({
      pool,
      // Session table is created by initDb() at startup — no need for the
      // store to attempt it mid-request, which can silently 500 on first login.
      createTableIfMissing: false,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Set COOKIE_SECURE=true only when the app is behind a TLS-terminating
      // reverse proxy (e.g. nginx with HTTPS).  Leave it unset for plain-HTTP
      // access (typical Unraid LAN setup) — the Secure flag would otherwise
      // cause the browser to silently drop the session cookie.
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve static frontend files in production (single-container Docker mode).
// Set STATIC_DIR to the directory containing the built frontend (index.html).
const staticDir = process.env.STATIC_DIR;
if (staticDir && existsSync(staticDir)) {
  logger.info({ staticDir }, "Serving static frontend");
  app.use(express.static(staticDir));
  // SPA fallback — let the React router handle all non-API paths.
  // Express 5 requires the named wildcard syntax /{*splat} instead of *.
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// Global JSON error handler — must be registered AFTER all routes.
// Without this, Express returns an HTML error page for unhandled errors
// (multer failures, DB errors, etc.) which the frontend XHR cannot parse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Multer errors (file too large, too many files, unexpected field, etc.)
  const isMulterError =
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "MulterError";

  if (isMulterError) {
    const multerErr = err as { code?: string; message?: string };
    if (multerErr.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large" });
      return;
    }
    res.status(400).json({ error: multerErr.message ?? "Upload error" });
    return;
  }

  // Everything else: log it and return a generic 500
  logger.error({ err }, "Unhandled error");
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

export default app;
