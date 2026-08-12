import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { filesTable } from "./files";
import { usersTable } from "./users";

export const shareTokensTable = pgTable("share_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  fileId: integer("file_id")
    .notNull()
    .references(() => filesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShareTokenSchema = createInsertSchema(shareTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShareToken = z.infer<typeof insertShareTokenSchema>;
export type ShareTokenRecord = typeof shareTokensTable.$inferSelect;
