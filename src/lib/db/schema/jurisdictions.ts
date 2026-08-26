import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const emirateEnum = pgEnum("emirate", [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
]);

export const jurisdictionTypeEnum = pgEnum("jurisdiction_type", [
  "mainland",
  "free_zone",
]);

export const jurisdictionStatusEnum = pgEnum("jurisdiction_status", [
  "active",
  "inactive",
  "deprecated",
]);

export const licensingAuthorities = pgTable("licensing_authorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  emirate: emirateEnum("emirate").notNull(),
  officialWebsite: varchar("official_website", { length: 500 }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const jurisdictions = pgTable("jurisdictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  emirate: emirateEnum("emirate").notNull(),
  jurisdictionType: jurisdictionTypeEnum("jurisdiction_type").notNull(),
  authorityId: uuid("authority_id").references(() => licensingAuthorities.id),
  officialWebsite: varchar("official_website", { length: 500 }),
  officialActivityUrl: varchar("official_activity_url", { length: 500 }),
  description: text("description"),
  status: jurisdictionStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const licenceTypes = pgTable("licence_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  jurisdictionId: uuid("jurisdiction_id")
    .references(() => jurisdictions.id)
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }),
  description: text("description"),
  sourceId: uuid("source_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
