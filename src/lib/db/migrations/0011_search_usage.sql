-- ============================================================
-- Migration 0011: per-user search usage history
-- Date: 2026-09-27
--
-- PURPOSE
--   The account dashboard needs to show a person their OWN search usage. This
--   table is the minimal store for that: one row per authenticated search, with
--   nothing on the row that the app does not need to draw a count.
--
-- WHAT IS DELIBERATELY NOT STORED HERE
--   * No password, OAuth access/refresh/id token, session cookie or any other
--     credential. Those never leave the auth provider (see migration 0010).
--   * No `auth_user_id` and no `provider_user_id`. The provider subject id is
--     only ever used to FIND the app_users row; once resolved, every reference
--     in this table is our own surrogate key. Copying the provider id here
--     would create a second, redundant copy of an external identity.
--   * No email, full name or avatar. All of that already lives on app_users
--     and is reachable through the foreign key if it is ever genuinely needed.
--   * No IP address and no user agent. There is no documented security
--     requirement for abuse attribution on this endpoint, and the endpoint is
--     already behind authentication, so there is no threat model here that
--     needs them. admin_audit_logs exists separately for administrative events
--     that DO have such a requirement; this table is not that.
--   * No full request headers, no raw URL, no result count, no facet state.
--     The feature only needs "this person ran a search, and when".
--
-- PRIVACY
--   A search query is free text and can contain a person's name, a company
--   name or a licence number, so this table holds personal data. It is
--   user-scoped, and nothing in the application reads another user's rows.
--
-- RETENTION — INTENTIONALLY PENDING
--   There is NO automatic deletion here, by decision, not by oversight. Before
--   this table goes live with real user data, a retention policy is required.
--   When it is written it should decide, at minimum:
--     * how long a raw query string is kept (it is only needed for the count),
--     * whether rows are deleted or anonymised after a window,
--     * what happens on account deletion.
--   The `user_id` foreign key below already cascades, so deleting an
--   app_users row removes its history in the same transaction — that part of the
--   policy is already enforced by the schema rather than by a job.
--
-- SAFETY
--   * Additive only: creates one new table and one new index.
--   * Touches no activities / jurisdictions / licences / approvals / fees data.
--     No column is altered or dropped anywhere in the database.
--   * `IF NOT EXISTS` throughout, so it is safe to re-run.
--   * `gen_random_uuid()` is already used by migration 0001, so no new
--     extension is required.
-- ============================================================

CREATE TABLE IF NOT EXISTS search_usage (
  -- Internal surrogate id. Never accepted from a request.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The account that ran the search. Resolved server-side from the verified
  -- session; a caller can never supply this value. ON DELETE CASCADE so an
  -- account's history disappears with the account.
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,

  -- The query text the person actually submitted, already trimmed and capped
  -- at the same 2000 characters the search endpoint accepts.
  query text NOT NULL,

  -- When the search ran. Indexed with user_id because every read is
  -- "this person's rows, newest first / within a window".
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Defence in depth: the application already caps the length before insert, so
  -- violating this means something bypassed that cap.
  CONSTRAINT search_usage_query_length_check
    CHECK (char_length(query) BETWEEN 1 AND 2000)
);

-- Serves both reads the dashboard performs: the lifetime total and the
-- trailing-30-day count. A composite index in this order means the 30-day
-- query is a range scan on a prefix of the index rather than a full scan.
CREATE INDEX IF NOT EXISTS idx_search_usage_user_created_at
  ON search_usage (user_id, created_at DESC);
