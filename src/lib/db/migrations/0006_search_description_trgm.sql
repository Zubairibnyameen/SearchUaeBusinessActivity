-- ============================================================
-- Migration 0006: Description trigram search index
-- Date: 2026-08-24
--
-- Evidence-based (benchmark 2026-08-23): description ILIKE tier was a
-- sequential scan taking ~256ms (~70% of end-to-end search latency).
-- A trigram GIN index brings it to single-digit milliseconds.
-- Category/group ILIKE measured at only ~16ms - left unindexed deliberately.
-- Idempotent.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS gin_activities_description_trgm
  ON activities USING gin (description gin_trgm_ops);
