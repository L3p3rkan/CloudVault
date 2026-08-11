import { pgTable, text, serial, boolean, timestamp, integer, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const filesTable = pgTable("files", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Virtual path in the user's file system (e.g. /photos/2024/beach.jpg)
  path: text("path").notNull(),
  // Parent directory path (e.g. /photos/2024)
  parentPath: text("parent_path").notNull().default("/"),
  // File size in bytes (0 for folders)
  size: bigint("size", { mode: "number" }).notNull().default(0),
  mimeType: text("mime_type"),
  isFolder: boolean("is_folder").notNull().default(false),
  // Actual path on disk (null for folders)
  diskPath: text("disk_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertFileSchema = createInsertSchema(filesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFile = z.infer<typeof insertFileSchema>;
export type FileRecord = typeof filesTable.$inferSelect;
