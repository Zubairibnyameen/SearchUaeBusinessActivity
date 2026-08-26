import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { jurisdictions } from "./jurisdictions";
import { verificationStatusEnum } from "./activities";

/**
 * Review queue for source rows that were deliberately NOT imported into the
 * canonical activities table — e.g. within-batch duplicate activity codes.
 *
 * The complete original source row is retained in `raw` together with a
 * `pending_review` status so suspicious duplicates are never silently
 * discarded. Resolution happens through manual review (status + note).
 */
export const importReviewQueue = pgTable("import_review_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .references(() => jurisdictions.id)
    .notNull(),
  discoveryId: varchar("discovery_id", { length: 100 }),
  reason: varchar("reason", { length: 50 }).notNull(),
  activityCode: varchar("activity_code", { length: 50 }),
  zone: varchar("zone", { length: 100 }),
  normalizedName: varchar("normalized_name", { length: 1000 }),
  raw: jsonb("raw").notNull(),
  reportPath: text("report_path"),
  status: verificationStatusEnum("status")
    .default("pending_review")
    .notNull(),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
