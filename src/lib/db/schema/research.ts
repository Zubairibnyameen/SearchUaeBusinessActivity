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
  index,
} from "drizzle-orm/pg-core";
import { activities, approvalSignalEnum } from "./activities";
import { jurisdictions } from "./jurisdictions";
import { sources } from "./sources";
import { approvals } from "./approvals";

/**
 * Regulatory research queue (Phase 3).
 *
 * A prioritized worklist for converting approval SIGNALS into VERIFIED
 * approvals — or honestly marking them not_required / conflicting.
 * Unresolved records are never deleted (activity FK is RESTRICT).
 */
export const regulatoryResearchStatusEnum = pgEnum("regulatory_research_status", [
  "pending_review",
  "researching",
  "verified",
  "not_required",
  "conflicting_sources",
  "needs_manual_review",
]);

export const regulatoryResearchQueue = pgTable(
  "regulatory_research_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .references(() => activities.id, { onDelete: "restrict" })
      .notNull(),
    /** Denormalized snapshots for fast admin filtering/display. */
    activityCode: varchar("activity_code", { length: 50 }),
    jurisdictionId: uuid("jurisdiction_id").references(() => jurisdictions.id),
    approvalSignal: approvalSignalEnum("approval_signal"),
    /** Lead authority name — a hint, never a verified claim. */
    possibleAuthority: varchar("possible_authority", { length: 255 }),
    researchStatus: regulatoryResearchStatusEnum("research_status")
      .default("pending_review")
      .notNull(),
    /**
     * Discovery lead URL. Third-party links may START research but can
     * never be the final source for a verified regulatory claim.
     */
    candidateSourceUrl: text("candidate_source_url"),
    verifiedSourceId: uuid("verified_source_id").references(() => sources.id),
    verificationDate: date("verification_date"),
    notes: text("notes"),
    reviewerAdmin: varchar("reviewer_admin", { length: 255 }),
    priorityScore: integer("priority_score").default(0).notNull(),
    priorityReasons: jsonb("priority_reasons"),
    /** Approval record created when this item resolves to verified. */
    resolutionApprovalId: uuid("resolution_approval_id").references(
      () => approvals.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    statusIdx: index("idx_rrq_status").on(t.researchStatus),
    jurisdictionIdx: index("idx_rrq_jurisdiction").on(t.jurisdictionId),
    priorityIdx: index("idx_rrq_priority").on(t.priorityScore),
    activityIdx: index("idx_rrq_activity").on(t.activityId),
  })
);

export type RegulatoryResearchItem = typeof regulatoryResearchQueue.$inferSelect;
export type NewRegulatoryResearchItem = typeof regulatoryResearchQueue.$inferInsert;
