-- ============================================================
-- Migration 0010: SaaS user accounts (Supabase/Google linked)
-- Date: 2026-09-27
--
-- PURPOSE
--   Adds the product user account model that the Google login flow is linked
--   to. Identity, credentials and session tokens stay inside the Supabase
--   auth provider; this table stores ONLY a non-sensitive profile projection
--   so the app can run role checks, show a user menu and populate the admin
--   dashboard without ever touching OAuth material.
--
-- WHAT IS DELIBERATELY NOT STORED HERE
--   * Google passwords — never seen by this application (OAuth only).
--   * OAuth client secrets, access tokens, refresh tokens, id_tokens.
--   * Any provider secret of any kind.
--   Only the provider's opaque subject id, the public profile fields Google
--   returns (name, email, avatar), and app-owned bookkeeping columns.
--
-- SAFETY
--   * Additive only: creates a new table and new indexes.
--   * Touches no activities / jurisdictions / licences / approvals / fees
--     data. No column is altered or dropped anywhere in the database.
--   * `IF NOT EXISTS` throughout, so it is safe to re-run.
--   * `gen_random_uuid()` is already used by migration 0001 (pgcrypto or
--     PG >= 13 built-in), so no new extension is required.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_users (
  -- Internal surrogate id used by the app.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The immutable user id issued by the authentication provider
  -- (Supabase auth.users.id). One provider identity === one app account.
  auth_user_id uuid NOT NULL,

  -- Provider discriminator ('google' today) + the provider's own subject id.
  -- Together these form the external identity key.
  provider varchar(50) NOT NULL DEFAULT 'google',
  provider_user_id varchar(255) NOT NULL,

  -- Public profile fields returned by the provider.
  email varchar(320) NOT NULL,
  full_name varchar(255),
  avatar_url text,

  -- App-owned authorization + lifecycle state.
  role varchar(20) NOT NULL DEFAULT 'user',
  status varchar(20) NOT NULL DEFAULT 'active',

  -- Bookkeeping.
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_users_auth_user_id_key UNIQUE (auth_user_id),
  CONSTRAINT app_users_role_check CHECK (role IN ('user', 'admin')),
  CONSTRAINT app_users_status_check CHECK (status IN ('active', 'suspended'))
);

-- External identity must be unique per provider (prevents a second row
-- claiming the same Google account).
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_provider_identity
  ON app_users (provider, provider_user_id);

-- Admin dashboard: case-insensitive email lookup + email search filter.
CREATE INDEX IF NOT EXISTS idx_app_users_email_lower
  ON app_users (lower(email));

-- Admin dashboard: "new users" / "recent sign-ins" ordering.
CREATE INDEX IF NOT EXISTS idx_app_users_created_at
  ON app_users (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_users_last_login_at
  ON app_users (last_login_at DESC);

-- Admin dashboard / role filters.
CREATE INDEX IF NOT EXISTS idx_app_users_role
  ON app_users (role);

CREATE INDEX IF NOT EXISTS idx_app_users_status
  ON app_users (status);
