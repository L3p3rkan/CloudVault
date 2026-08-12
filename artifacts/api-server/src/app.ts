import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const PgSession = ConnectPgSimple(session);

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
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

export default app;
