-- ============================================================
-- Migration 0003: Widen canonical name columns
-- Date: 2026-08-23
--
-- Official sources publish long descriptive names (e.g. SPC Free Zone
-- Arabic names up to ~750 chars). varchar(500) rejected real rows.
--
-- The plain btree indexes over name columns are dropped deliberately:
-- btree index tuples are not TOASTed and fail beyond ~2.7KB, which
-- multi-byte names can reach. Trigram GIN indexes from migration 0001
-- remain the search path for names.
--
-- Idempotent: safe to run multiple times.
-- ============================================================

ALTER TABLE activities ALTER COLUMN official_name    TYPE varchar(1000);
ALTER TABLE activities ALTER COLUMN normalized_name  TYPE varchar(1000);
ALTER TABLE activities ALTER COLUMN official_name_ar TYPE varchar(1000);

DROP INDEX IF EXISTS idx_activities_normalized_name;
DROP INDEX IF EXISTS idx_activities_official_name;
DROP INDEX IF EXISTS idx_activities_jurisdiction_normname;
