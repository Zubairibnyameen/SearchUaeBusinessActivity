-- ============================================================
-- Migration 0005: Admin audit log
-- Date: 2026-08-24
--
-- Security-relevant admin events (auth attempts, data mutations).
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event varchar(100) NOT NULL,
  outcome varchar(20) NOT NULL DEFAULT 'success',
  ip varchar(64),
  user_agent text,
  details jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_event ON admin_audit_logs (event, created_at);
