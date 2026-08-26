-- ============================================================
-- Migration 0002: Canonical ingestion model v2
-- Date: 2026-08-23
--
-- Adds:
--   - activities.official_name_ar / isic_code / zone / restrictions /
--     approval_signal / source_extra
--   - activity_approval_signals (structured source signals, NOT verified approvals)
--   - activity_source_prices (source-published prices, kept separate from fees)
--
-- Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- New enums (created only if missing)
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE approval_signal AS ENUM (
    'no_signal',
    'third_party_approval_indicated',
    'may_be_required',
    'restricted',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE approval_signal_type AS ENUM (
    'third_party_authority_indicated',
    'third_party_approval_required',
    'restriction_noted',
    'other_signal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_kind AS ENUM ('source_activity_price');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- activities: new columns
-- ------------------------------------------------------------
ALTER TABLE activities ADD COLUMN IF NOT EXISTS official_name_ar varchar(500);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS isic_code        varchar(50);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS zone             varchar(100);
ALTER TABLE activities ADD COLUMN IF NOT EXISTS restrictions     text;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS approval_signal  approval_signal NOT NULL DEFAULT 'unknown';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS source_extra     jsonb;

-- ------------------------------------------------------------
-- activity_approval_signals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_approval_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  signal_type approval_signal_type NOT NULL,
  authority_name varchar(255),
  notes text,
  source_id uuid,
  last_verified date,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_signals_activity_id ON activity_approval_signals (activity_id);
CREATE INDEX IF NOT EXISTS idx_approval_signals_authority   ON activity_approval_signals (authority_name);

-- ------------------------------------------------------------
-- activity_source_prices
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_source_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  price_kind price_kind NOT NULL DEFAULT 'source_activity_price',
  amount numeric(12,2),
  currency varchar(3) NOT NULL DEFAULT 'AED',
  conditions text,
  source_id uuid,
  retrieved_date date,
  last_verified date,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_prices_activity_id ON activity_source_prices (activity_id);
