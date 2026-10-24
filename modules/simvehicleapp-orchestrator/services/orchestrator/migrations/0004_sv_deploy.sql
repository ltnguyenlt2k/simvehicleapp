-- Deploy targets and deployments (ADR-0060, M18-T09): a workspace's databrokers outside the stack, and the run of an
-- app deployed to one of them (its route through the vehicle-gateway, read-only or read-write).
CREATE TABLE sv.deploy_target (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  name text NOT NULL,
  address text NOT NULL,
  tls boolean NOT NULL DEFAULT false,
  token_enc text,
  vss_release text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);
ALTER TABLE sv.run ADD COLUMN deploy jsonb;
