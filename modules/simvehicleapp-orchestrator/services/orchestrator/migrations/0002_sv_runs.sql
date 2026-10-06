-- Live runs (M8, ADR-0027): what a run needs from its generation (node → block map of the trace,
-- signals the app reads/writes), the runs and their event log (logs + trace, SSE resume by seq).
ALTER TABLE sv.generation ADD COLUMN run_info jsonb;

CREATE TABLE sv.run (
  id              text PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES sv.project(id) ON DELETE CASCADE,
  generation_id   text NOT NULL REFERENCES sv.generation(id) ON DELETE CASCADE,
  state           text NOT NULL CHECK (state IN ('starting', 'running', 'stopping', 'stopped', 'crashed')),
  vss_release     text NOT NULL,
  trace_level     text NOT NULL CHECK (trace_level IN ('off', 'trigger', 'node')),
  job_id          text,
  exit_code       integer,
  diagnostics     jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  running_at      timestamptz,
  finished_at     timestamptz
);
CREATE INDEX run_project ON sv.run (project_id, created_at DESC);
CREATE INDEX run_active ON sv.run (state) WHERE state IN ('starting', 'running', 'stopping');

CREATE TABLE sv.run_event (
  run_id          text NOT NULL REFERENCES sv.run(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('log', 'trace')),
  body            jsonb NOT NULL,
  PRIMARY KEY (run_id, seq)
);
