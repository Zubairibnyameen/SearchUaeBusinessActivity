import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

/**
 * Security-relevant administrative events: authentication attempts and
 * (future) data mutations performed from the admin panel.
 */
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: varchar("event", { length: 100 }).notNull(),
  outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
