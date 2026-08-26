-- ============================================================
-- Migration 0001: Search-critical indexes
-- Date: 2026-08-23
--
-- Applied manually via scripts/apply-migrations.ts
-- (no drizzle migration journal exists; tables were created via db:push)
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- Trigram extension for ILIKE '%term%' acceleration.
-- NOTE: pgvector intentionally NOT enabled yet.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- activities: single-column btree (exact match / equality tiers)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activities_normalized_name ON activities (normalized_name);
CREATE INDEX IF NOT EXISTS idx_activities_official_name    ON activities (official_name);
CREATE INDEX IF NOT EXISTS idx_activities_activity_code    ON activities (activity_code);
CREATE INDEX IF NOT EXISTS idx_activities_official_category ON activities (official_category);
CREATE INDEX IF NOT EXISTS idx_activities_activity_group   ON activities (activity_group);
CREATE INDEX IF NOT EXISTS idx_activities_jurisdiction_id  ON activities (jurisdiction_id);

-- ------------------------------------------------------------
-- activities: composite (jurisdiction-scoped lookups, dedupe checks)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activities_jurisdiction_code     ON activities (jurisdiction_id, activity_code);
CREATE INDEX IF NOT EXISTS idx_activities_jurisdiction_normname ON activities (jurisdiction_id, normalized_name);

-- ------------------------------------------------------------
-- activities: trigram GIN for ILIKE substring search
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS gin_activities_normalized_name_trgm ON activities USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS gin_activities_official_name_trgm   ON activities USING gin (official_name gin_trgm_ops);

-- ------------------------------------------------------------
-- activity_synonyms
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_synonyms_term        ON activity_synonyms (term);
CREATE INDEX IF NOT EXISTS gin_activity_synonyms_term_trgm   ON activity_synonyms USING gin (term gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_activity_synonyms_activity_id ON activity_synonyms (activity_id);

-- ------------------------------------------------------------
-- Supporting indexes for ingestion dedupe + audit queries
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_activity_sources_activity_id ON activity_sources (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_sources_source_id   ON activity_sources (source_id);
