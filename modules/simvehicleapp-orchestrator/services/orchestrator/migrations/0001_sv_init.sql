-- Schema `sv` of the orchestrator (analysis/03 §5, ADR-0007 §4): projects, workflows of a project,
-- SynCode generations with their stages and event log. Runs (M8) come in a later migration.
CREATE SCHEMA IF NOT EXISTS sv;

CREATE TABLE sv.project (
  id              uuid PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  app_name        text NOT NULL,
  language        text NOT NULL CHECK (language IN ('cpp', 'python', 'rust')),
  vss_release     text NOT NULL,
  settings        jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL CHECK (status IN ('creating', 'ready', 'failed')),
  status_message  text,
  deps_installed  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sv.project_workflow (
  project_id      uuid NOT NULL REFERENCES sv.project(id) ON DELETE CASCADE,
  sim_workflow_id text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (project_id, sim_workflow_id)
);

CREATE TABLE sv.generation (
  id              text PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES sv.project(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage           text,
  stages          jsonb NOT NULL DEFAULT '[]',
  verification    jsonb NOT NULL,
  diagnostics     jsonb NOT NULL DEFAULT '[]',
  generated_files jsonb NOT NULL DEFAULT '[]',
  workflows       jsonb NOT NULL DEFAULT '[]',
  backend         text,
  compiler_version text,
  model_hash      text,
  request         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX generation_queue ON sv.generation (state, created_at);
CREATE INDEX generation_project ON sv.generation (project_id, created_at DESC);

CREATE TABLE sv.generation_event (
  generation_id   text NOT NULL REFERENCES sv.generation(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  line            jsonb NOT NULL,
  PRIMARY KEY (generation_id, seq)
);
