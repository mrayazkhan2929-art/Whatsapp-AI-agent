ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS distress_deal BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_properties_distress_deal
  ON properties(org_id, source, distress_deal);
