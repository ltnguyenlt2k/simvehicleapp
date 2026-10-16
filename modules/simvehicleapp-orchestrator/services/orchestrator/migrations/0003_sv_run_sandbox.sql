-- Multi-user vehicle runtime (ADR-0057, M17-T04): who started a run (quotas), its own databroker, its expiry and
-- why it stopped.
ALTER TABLE sv.run ADD COLUMN owner_user_id text;
ALTER TABLE sv.run ADD COLUMN owner_workspace_id text;
ALTER TABLE sv.run ADD COLUMN sandbox_address text;
ALTER TABLE sv.run ADD COLUMN expires_at timestamptz;
ALTER TABLE sv.run ADD COLUMN extensions integer NOT NULL DEFAULT 0;
ALTER TABLE sv.run ADD COLUMN stop_reason text CHECK (stop_reason IN ('user', 'expired', 'admin'));
CREATE INDEX run_owner_active ON sv.run (owner_user_id) WHERE state IN ('starting', 'running', 'stopping');
