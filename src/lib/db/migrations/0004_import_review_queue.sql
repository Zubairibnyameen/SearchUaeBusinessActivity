-- Import review queue: retains source rows that were NOT imported into the
-- canonical activities table (e.g. within-batch duplicate codes), together
-- with their complete original data and a pending_review status so that
-- nothing is silently discarded.

CREATE TABLE IF NOT EXISTS import_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id uuid REFERENCES jurisdictions(id) NOT NULL,
  discovery_id varchar(100),
  reason varchar(50) NOT NULL,
  activity_code varchar(50),
  zone varchar(100),
  normalized_name varchar(1000),
  raw jsonb NOT NULL,
  report_path text,
  status verification_status DEFAULT 'pending_review' NOT NULL,
  resolution_note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_review_queue_jurisdiction ON import_review_queue(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON import_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_code ON import_review_queue(activity_code);
