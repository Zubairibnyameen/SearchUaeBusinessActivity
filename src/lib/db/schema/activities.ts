import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { jurisdictions } from "./jurisdictions";
import { licenceTypes } from "./jurisdictions";

export const approvalStatusEnum = pgEnum("approval_status", [
  "no_additional_approval",
  "approval_required",
  "approval_may_be_required",
  "conditional_approval",
  "multiple_approvals_required",
  "restricted_activity",
  "not_permitted",
  "unknown",
]);

/**
 * Approval SIGNAL = what the official activity source indicates.
 * Distinct from a VERIFIED approval record (approvals table).
 * Never promote a signal into an approval without authoritative verification.
 */
export const approvalSignalEnum = pgEnum("approval_signal", [
  "no_signal",
  "third_party_approval_indicated",
  "may_be_required",
  "restricted",
  "unknown",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "verified",
  "pending_review",
  "outdated",
  "unverified",
  "conflict",
]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .references(() => jurisdictions.id)
    .notNull(),
  licenceTypeId: uuid("licence_type_id").references(() => licenceTypes.id),
  activityCode: varchar("activity_code", { length: 50 }),
  officialName: varchar("official_name", { length: 1000 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 1000 }).notNull(),
  description: text("description"),
  officialNameAr: varchar("official_name_ar", { length: 1000 }),
  isicCode: varchar("isic_code", { length: 50 }),
  officialCategory: varchar("official_category", { length: 255 }),
  normalizedCategory: varchar("normalized_category", { length: 255 }),
  activityGroup: varchar("activity_group", { length: 255 }),
  activitySubcategory: varchar("activity_subcategory", { length: 255 }),
  /** Source's own zone/sub-jurisdiction classification (e.g. RAKEZ Freezone vs Non-Freezone). Preserved verbatim. */
  zone: varchar("zone", { length: 100 }),
  restrictions: text("restrictions"),
  /** Canonical approval indication taken from the official source. */
  approvalSignal: approvalSignalEnum("approval_signal")
    .default("unknown")
    .notNull(),
  /** Source-specific fields that have no dedicated column. Raw row preserved regardless. */
  sourceExtra: jsonb("source_extra"),
  approvalStatus: approvalStatusEnum("approval_status")
    .default("unknown")
    .notNull(),
  verificationStatus: verificationStatusEnum("verification_status")
    .default("unverified")
    .notNull(),
  lastVerified: date("last_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activitySynonyms = pgTable("activity_synonyms", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  term: varchar("term", { length: 255 }).notNull(),
  language: varchar("language", { length: 10 }).default("en").notNull(),
  source: varchar("source", { length: 255 }),
  confidence: integer("confidence"),
});

export const activityRelationships = pgTable("activity_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  relatedActivityId: uuid("related_activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  relationshipType: varchar("relationship_type", { length: 50 }).notNull(),
  confidence: integer("confidence"),
});

export const activitySources = pgTable("activity_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  sourceId: uuid("source_id").notNull(),
  relevance: varchar("relevance", { length: 50 }),
});
