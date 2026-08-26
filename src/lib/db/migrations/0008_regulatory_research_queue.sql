-- ============================================================
-- Migration 0008: Regulatory research queue + approval record fields
-- Date: 2026-08-24
--
-- Phase 3 Parts 2/5/6:
--  * regulatory_research_queue — prioritized worklist for verifying
--    approval SIGNALS into VERIFIED approvals (or honest not_required).
--    Unresolved records are never deleted (RESTRICT on activity).
--  * approvals.application_process — required by the approval-record spec.
--  * approvals.verification_status — reuses the existing `verification_status`
--    enum (verified/pending_review/outdated/unverified/conflict) so an
--    approval requirement is distinguishable from its verification state.
-- Idempotent.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE regulatory_research_status AS ENUM (
    'pending_review',
    'researching',
    'verified',
    'not_required',
    'conflicting_sources',
    'needs_manual_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS regulatory_research_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  -- Denormalized snapshots for fast admin filtering/display
  activity_code varchar(50),
  jurisdiction_id uuid REFERENCES jurisdictions(id),
  approval_signal approval_signal,
  possible_authority varchar(255),
  research_status regulatory_research_status NOT NULL DEFAULT 'pending_review',
  -- Discovery lead only — never sufficient for a verified claim
  candidate_source_url text,
  verified_source_id uuid REFERENCES sources(id),
  verification_date date,
  notes text,
  reviewer_admin varchar(255),
  priority_score integer NOT NULL DEFAULT 0,
  priority_reasons jsonb,
  resolution_approval_id uuid REFERENCES approvals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rrq_status
  ON regulatory_research_queue (research_status);
CREATE INDEX IF NOT EXISTS idx_rrq_jurisdiction
  ON regulatory_research_queue (jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_rrq_priority
  ON regulatory_research_queue (priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_rrq_activity
  ON regulatory_research_queue (activity_id);

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS application_process text;

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS verification_status verification_status
    NOT NULL DEFAULT 'unverified';
