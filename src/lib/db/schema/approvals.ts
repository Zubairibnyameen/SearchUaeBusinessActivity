import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  decimal,
  boolean,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { activities, verificationStatusEnum } from "./activities";
import { sources } from "./sources";

export const approvalTypeEnum = pgEnum("approval_type", [
  "regulatory_permit",
  "professional_license",
  "sector_approval",
  "noc",
  "inspection",
  "certification",
  "registration",
  "other",
]);

export const approvalRecordStatusEnum = pgEnum("approval_record_status", [
  "required",
  "may_be_required",
  "conditional",
  "not_required",
  "unknown",
]);

export const approvalAuthorities = pgTable("approval_authorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  officialWebsite: varchar("official_website", { length: 500 }),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .references(() => activities.id, { onDelete: "cascade" })
    .notNull(),
  approvalAuthorityId: uuid("approval_authority_id").references(
    () => approvalAuthorities.id
  ),
  name: varchar("name", { length: 255 }).notNull(),
  approvalType: approvalTypeEnum("approval_type").notNull(),
  status: approvalRecordStatusEnum("approval_record_status")
    .default("unknown")
    .notNull(),
  description: text("description"),
  conditions: jsonb("conditions"),
  requiredDocuments: jsonb("required_documents"),
  professionalRequirement: text("professional_requirement"),
  facilityRequirement: text("facility_requirement"),
  inspectionRequired: boolean("inspection_required").default(false),
  nocRequired: boolean("noc_required").default(false),
  /** How to apply, as described by the authoritative source. Never invented. */
  applicationProcess: text("application_process"),
  sourceId: uuid("source_id").references(() => sources.id),
  lastVerified: date("last_verified"),
  /**
   * Verification state of THIS record (distinct from requirement `status`).
   * Reuses the activities verification_status enum:
   * verified | pending_review | outdated | unverified | conflict
   */
  verificationStatus: verificationStatusEnum("verification_status")
    .default("unverified")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const feeTypeEnum = pgEnum("fee_type", [
  "application_fee",
  "approval_fee",
  "registration_fee",
  "permit_fee",
  "inspection_fee",
  "noc_fee",
  "certificate_fee",
  "renewal_fee",
  "annual_regulatory_fee",
  "other_government_fee",
]);

export const feeBasisEnum = pgEnum("fee_basis", [
  "fixed",
  "starting_from",
  "per_application",
  "per_licence",
  "per_year",
  "per_employee",
  "per_location",
  "per_facility",
  "per_inspection",
  "percentage_based",
  "depends_on_activity",
  "depends_on_company_size",
  "depends_on_regulator",
  "not_publicly_available",
]);

export const approvalFees = pgTable("approval_fees", {
  id: uuid("id").primaryKey().defaultRandom(),
  approvalId: uuid("approval_id")
    .references(() => approvals.id, { onDelete: "cascade" })
    .notNull(),
  feeType: feeTypeEnum("fee_type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("AED").notNull(),
  feeBasis: feeBasisEnum("fee_basis").notNull(),
  conditions: text("conditions"),
  isMandatory: boolean("is_mandatory").default(true).notNull(),
  sourceId: uuid("source_id"),
  effectiveDate: date("effective_date"),
  lastVerified: date("last_verified"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const thirdPartyCostTypeEnum = pgEnum("third_party_cost_type", [
  "laboratory",
  "testing",
  "certification_body",
  "technical_consultant",
  "professional_consultant",
  "other",
]);

export const thirdPartyCosts = pgTable("third_party_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  approvalId: uuid("approval_id")
    .references(() => approvals.id, { onDelete: "cascade" })
    .notNull(),
  costType: thirdPartyCostTypeEnum("third_party_cost_type").notNull(),
  description: text("description"),
  estimatedAmount: decimal("estimated_amount", { precision: 12, scale: 2 }),
  currency: varchar("currency", { length: 3 }).default("AED").notNull(),
  sourceId: uuid("source_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
