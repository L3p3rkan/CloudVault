import { initDb } from "./lib/init-db";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure all tables exist before accepting traffic.
// Uses CREATE TABLE IF NOT EXISTS — safe whether the DB is brand-new
// (first Docker boot) or already populated (dev restarts).
logger.info("Initialising database schema");
await initDb();
logger.info("Database schema ready");

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Disable Node.js's built-in request timeout (default 300 s in Node 18+).
// Large file uploads (multi-GB) can take much longer than 5 minutes on a
// typical home LAN, and timing out mid-stream corrupts the upload without a
// useful error message.  Multer's own fileSize limit is the real guard here.
server.requestTimeout = 0;
