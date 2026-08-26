-- ============================================================
-- Migration 0007: Enforce source_id foreign keys
-- Date: 2026-08-24
--
-- Phase 3 Part 1: every record carrying a regulatory claim must point at
-- its official source. Orphan checks returned 0 rows for all tables,
-- so constraints are safe to add immediately.
-- Idempotent via IF NOT EXISTS guards.
-- ============================================================

ALTER TABLE licence_types
  DROP CONSTRAINT IF EXISTS fk_licence_types_source;
ALTER TABLE licence_types
  ADD CONSTRAINT fk_licence_types_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE approvals
  DROP CONSTRAINT IF EXISTS fk_approvals_source;
ALTER TABLE approvals
  ADD CONSTRAINT fk_approvals_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE approval_fees
  DROP CONSTRAINT IF EXISTS fk_approval_fees_source;
ALTER TABLE approval_fees
  ADD CONSTRAINT fk_approval_fees_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE third_party_costs
  DROP CONSTRAINT IF EXISTS fk_third_party_costs_source;
ALTER TABLE third_party_costs
  ADD CONSTRAINT fk_third_party_costs_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE activity_approval_signals
  DROP CONSTRAINT IF EXISTS fk_activity_approval_signals_source;
ALTER TABLE activity_approval_signals
  ADD CONSTRAINT fk_activity_approval_signals_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE activity_source_prices
  DROP CONSTRAINT IF EXISTS fk_activity_source_prices_source;
ALTER TABLE activity_source_prices
  ADD CONSTRAINT fk_activity_source_prices_source
  FOREIGN KEY (source_id) REFERENCES sources(id);

ALTER TABLE activity_sources
  DROP CONSTRAINT IF EXISTS fk_activity_sources_source;
ALTER TABLE activity_sources
  ADD CONSTRAINT fk_activity_sources_source
  FOREIGN KEY (source_id) REFERENCES sources(id);
