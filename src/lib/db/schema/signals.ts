import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  numeric,
  pgEnum,
} from "drizzle-orm/pg-core";
import { activities } from "./activities";

/**
 * Structured approval SIGNALS captured from official activity sources
 * (e.g. SPC "Third Party Authority", DMCC "Third Party Approval Required").
 *
 * These are NOT verified approvals. A verified approval lives in the
 * `approvals` table and requires authoritative confirmation.
 */
export const approvalSignalTypeEnum = pgEnum("approval_signal_type", [
  "third_party_authority_indicated",
  "third_party_approval_required",
  "restriction_noted",
  "other_signal",
]);

export const activityApprovalSignals = pgTable("activity_approval_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  signalType: approvalSignalTypeEnum("signal_type").notNull(),
  /** Named authority where the source exposes one (e.g. SPC third-party authority). */
  authorityName: varchar("authority_name", { length: 255 }),
  notes: text("notes"),
  sourceId: uuid("source_id"),
  lastVerified: date("last_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Prices published by an official activity source.
 * Preserved as `source_activity_price` until the source explicitly identifies
 * the price as a government approval fee. NEVER merged into approval_fees
 * without verification, and never mixed with third-party costs.
 */
export const priceKindEnum = pgEnum("price_kind", ["source_activity_price"]);

export const activitySourcePrices = pgTable("activity_source_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  priceKind: priceKindEnum("price_kind")
    .default("source_activity_price")
    .notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("AED").notNull(),
  conditions: text("conditions"),
  sourceId: uuid("source_id"),
  retrievedDate: date("retrieved_date"),
  lastVerified: date("last_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
