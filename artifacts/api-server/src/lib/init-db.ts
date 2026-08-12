/**
 * Idempotent schema initialisation.
 *
 * Runs CREATE TABLE IF NOT EXISTS for every table on every server start.
 * Safe to call against an existing database (dev) or a brand-new one
 * (fresh Docker container) — no migration-tracking table required.
 */
import { pool } from "@workspace/db";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "users" (
  "id"            serial PRIMARY KEY NOT NULL,
  "username"      text NOT NULL,
  "email"         text,
  "password_hash" text NOT NULL,
  "is_admin"      boolean DEFAULT false NOT NULL,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_username_unique" UNIQUE("username")
);

CREATE TABLE IF NOT EXISTS "files" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     integer NOT NULL,
  "name"        text NOT NULL,
  "path"        text NOT NULL,
  "parent_path" text DEFAULT '/' NOT NULL,
  "size"        bigint DEFAULT 0 NOT NULL,
  "mime_type"   text,
  "is_folder"   boolean DEFAULT false NOT NULL,
  "disk_path"   text,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "share_tokens" (
  "id"         serial PRIMARY KEY NOT NULL,
  "token"      text NOT NULL,
  "file_id"    integer NOT NULL,
  "user_id"    integer NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "share_tokens_token_unique" UNIQUE("token")
);

-- Foreign keys — guarded so they're safe to run against an existing schema.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'files_user_id_users_id_fk' AND table_name = 'files'
  ) THEN
    ALTER TABLE "files"
      ADD CONSTRAINT "files_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'share_tokens_file_id_files_id_fk' AND table_name = 'share_tokens'
  ) THEN
    ALTER TABLE "share_tokens"
      ADD CONSTRAINT "share_tokens_file_id_files_id_fk"
      FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'share_tokens_user_id_users_id_fk' AND table_name = 'share_tokens'
  ) THEN
    ALTER TABLE "share_tokens"
      ADD CONSTRAINT "share_tokens_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
  END IF;
END $$;
`;

export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(INIT_SQL);
  } finally {
    client.release();
  }
}
