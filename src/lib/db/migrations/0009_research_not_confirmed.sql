-- 0009_research_not_confirmed.sql
--
-- STEP 9 — add the `not_confirmed` status to the regulatory research queue.
--
-- WHY:
--   The admin research workflow must be able to honestly record that an item
--   could NOT be confirmed, as a state DISTINCT from `not_required`.
--   "NOT FOUND is not the same as NOT REQUIRED": absence of evidence must
--   never be converted into a negative regulatory conclusion. Without this
--   state an admin can only say "verified not_required" (evidence-backed) or
--   leave the item unresolved — there was no honest "could not confirm" state.
--
-- HOW: additive enum extension. Existing rows are unaffected; PG allows adding
--   a value to an enum without a table rewrite. `IF NOT EXISTS` (available in
--   transactional PG >= 12) makes this safe to re-run and safe to apply to an
--   existing database that already has the 0001-0008 migrations.
--
-- SAFETY:
--   * Documented ONLY for this step. NOT applied to any database.
--   * Do NOT run against the Neon production database or the local database
--     as part of STEP 9.
--   * No table, column, or index change. No data mutation.

ALTER TYPE regulatory_research_status
  ADD VALUE IF NOT EXISTS 'not_confirmed';