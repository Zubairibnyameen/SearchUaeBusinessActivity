import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";

export const sourceTypeEnum = pgEnum("source_type", [
  "federal_government",
  "government_authority",
  "mainland_authority",
  "free_zone_authority",
  "sector_regulator",
  "government_pdf",
  "secondary_source",
]);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: varchar("url", { length: 1000 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  authority: varchar("authority", { length: 255 }),
  publishedDate: date("published_date"),
  retrievedDate: date("retrieved_date"),
  lastVerified: date("last_verified"),
  contentHash: varchar("content_hash", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verificationHistoryEnum = pgEnum("verification_entity_type", [
  "activity",
  "approval",
  "fee",
  "jurisdiction",
  "licence_type",
  "source",
]);

export const verificationHistory = pgTable("verification_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: verificationHistoryEnum("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  sourceId: uuid("source_id").references(() => sources.id),
  verificationStatus: varchar("verification_status", { length: 50 }).notNull(),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  verifiedBy: varchar("verified_by", { length: 255 }),
  notes: text("notes"),
});

export const historicalVersions = pgTable("historical_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  effectiveDate: date("effective_date"),
  changedDate: date("changed_date").defaultNow(),
  sourceId: uuid("source_id").references(() => sources.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
