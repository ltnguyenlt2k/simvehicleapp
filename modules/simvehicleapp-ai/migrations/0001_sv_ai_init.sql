-- Schema `sv_ai` of the ai-assistant (ADR-0007 §4, ADR-0030 §6): conversations of a user, their messages in
-- the canonical content-block shape, and the one pending sensitive action of a conversation.
CREATE SCHEMA IF NOT EXISTS sv_ai;

CREATE TABLE sv_ai.conversation (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  title       text NOT NULL DEFAULT '',
  workflow_id text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_user ON sv_ai.conversation (user_id, updated_at DESC);

CREATE TABLE sv_ai.message (
  conversation_id text NOT NULL REFERENCES sv_ai.conversation(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         jsonb NOT NULL,
  PRIMARY KEY (conversation_id, seq)
);

CREATE TABLE sv_ai.pending_action (
  action_id       text PRIMARY KEY,
  conversation_id text NOT NULL UNIQUE REFERENCES sv_ai.conversation(id) ON DELETE CASCADE,
  tool_name       text NOT NULL,
  tool_use_id     text NOT NULL,
  tool_input      jsonb NOT NULL,
  other_results   jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
