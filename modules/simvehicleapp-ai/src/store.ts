import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";
import type { Message, ToolResultBlock } from "./providers/types.ts";

/**
 * Conversations of the assistant (schema `sv_ai`, M10-T07): messages in the canonical content-block
 * shape, and at most one pending sensitive action per conversation (ADR-0030 §6, TTL 15 min).
 * Conversations untouched for `SV_AI_RETENTION_DAYS` are deleted.
 */

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  workflowId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PendingAction {
  actionId: string;
  conversationId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  /** Results of the other tool calls of the same assistant message (sent with this one's). */
  otherResults: ToolResultBlock[];
  createdAt: number;
  expiresAt: number;
}

export interface Store {
  migrate(): Promise<void>;
  createConversation(c: Conversation): Promise<void>;
  conversation(id: string): Promise<Conversation | null>;
  conversations(userId: string, limit?: number): Promise<Conversation[]>;
  touch(id: string, patch: { title?: string; workflowId?: string }): Promise<void>;
  messages(id: string): Promise<Message[]>;
  append(id: string, messages: Message[]): Promise<void>;
  pending(conversationId: string): Promise<PendingAction | null>;
  setPending(a: PendingAction): Promise<void>;
  clearPending(conversationId: string): Promise<void>;
  /** Deletes conversations not updated since `before` (epoch ms); returns how many. */
  purge(before: number): Promise<number>;
}

export class MemoryStore implements Store {
  readonly convs = new Map<string, Conversation>();
  readonly msgs = new Map<string, Message[]>();
  readonly actions = new Map<string, PendingAction>();
  constructor(private readonly now: () => number = Date.now) {}
  async migrate() {}
  async createConversation(c: Conversation) {
    this.convs.set(c.id, { ...c });
    this.msgs.set(c.id, []);
  }
  async conversation(id: string) {
    const c = this.convs.get(id);
    return c ? { ...c } : null;
  }
  async conversations(userId: string, limit = 50) {
    return [...this.convs.values()].filter((c) => c.userId === userId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
  async touch(id: string, patch: { title?: string; workflowId?: string }) {
    const c = this.convs.get(id);
    if (c) Object.assign(c, { ...patch, updatedAt: this.now() });
  }
  async messages(id: string) {
    return structuredClone(this.msgs.get(id) ?? []);
  }
  async append(id: string, messages: Message[]) {
    this.msgs.set(id, [...(this.msgs.get(id) ?? []), ...structuredClone(messages)]);
  }
  async pending(conversationId: string) {
    const a = this.actions.get(conversationId);
    if (a && a.expiresAt <= this.now()) {
      this.actions.delete(conversationId);
      return null;
    }
    return a ? structuredClone(a) : null;
  }
  async setPending(a: PendingAction) {
    this.actions.set(a.conversationId, structuredClone(a));
  }
  async clearPending(conversationId: string) {
    this.actions.delete(conversationId);
  }
  async purge(before: number) {
    let n = 0;
    for (const c of [...this.convs.values()]) {
      if (c.updatedAt < before) {
        this.convs.delete(c.id);
        this.msgs.delete(c.id);
        this.actions.delete(c.id);
        n++;
      }
    }
    return n;
  }
}

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
type Row = Record<string, unknown>;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export class PgStore implements Store {
  constructor(private readonly sql: SQL) {}
  static connect(url: string) {
    return new PgStore(new SQL(url));
  }
  async migrate() {
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('sv_ai.migrations'))`;
      await tx`CREATE SCHEMA IF NOT EXISTS sv_ai`;
      await tx`CREATE TABLE IF NOT EXISTS sv_ai.schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      const done = new Set(((await tx`SELECT version FROM sv_ai.schema_migration`) as Row[]).map((r) => String(r.version)));
      for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
        const version = file.replace(/\.sql$/, "");
        if (done.has(version)) continue;
        await tx.unsafe(readFileSync(MIGRATIONS + file, "utf8"));
        await tx`INSERT INTO sv_ai.schema_migration (version) VALUES (${version})`;
      }
    });
  }
  private toConv(r: Row): Conversation {
    return { id: String(r.id), userId: String(r.user_id), title: String(r.title ?? ""), ...(r.workflow_id ? { workflowId: String(r.workflow_id) } : {}), createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) };
  }
  async createConversation(c: Conversation) {
    await this.sql`INSERT INTO sv_ai.conversation (id, user_id, title, workflow_id, created_at, updated_at) VALUES (${c.id}, ${c.userId}, ${c.title}, ${c.workflowId ?? null}, ${new Date(c.createdAt)}, ${new Date(c.updatedAt)})`;
  }
  async conversation(id: string) {
    const rows = (await this.sql`SELECT * FROM sv_ai.conversation WHERE id = ${id}`) as Row[];
    return rows[0] ? this.toConv(rows[0]) : null;
  }
  async conversations(userId: string, limit = 50) {
    return ((await this.sql`SELECT * FROM sv_ai.conversation WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT ${limit}`) as Row[]).map((r) => this.toConv(r));
  }
  async touch(id: string, patch: { title?: string; workflowId?: string }) {
    if (patch.title !== undefined) await this.sql`UPDATE sv_ai.conversation SET title = ${patch.title} WHERE id = ${id}`;
    if (patch.workflowId !== undefined) await this.sql`UPDATE sv_ai.conversation SET workflow_id = ${patch.workflowId} WHERE id = ${id}`;
    await this.sql`UPDATE sv_ai.conversation SET updated_at = now() WHERE id = ${id}`;
  }
  async messages(id: string) {
    return ((await this.sql`SELECT role, content FROM sv_ai.message WHERE conversation_id = ${id} ORDER BY seq`) as Row[]).map((r) => ({ role: r.role as Message["role"], content: parse<Message["content"]>(r.content) }));
  }
  async append(id: string, messages: Message[]) {
    if (!messages.length) return;
    await this.sql.begin(async (tx) => {
      const n = ((await tx`SELECT count(*)::int AS n FROM sv_ai.message WHERE conversation_id = ${id}`) as { n: number }[])[0]?.n ?? 0;
      const rows = messages.map((m, i) => ({ conversation_id: id, seq: n + i, role: m.role, content: m.content }));
      await tx`INSERT INTO sv_ai.message ${tx(rows)}`;
    });
  }
  async pending(conversationId: string) {
    await this.sql`DELETE FROM sv_ai.pending_action WHERE conversation_id = ${conversationId} AND expires_at <= now()`;
    const rows = (await this.sql`SELECT * FROM sv_ai.pending_action WHERE conversation_id = ${conversationId}`) as Row[];
    const r = rows[0];
    return r
      ? { actionId: String(r.action_id), conversationId: String(r.conversation_id), toolName: String(r.tool_name), toolUseId: String(r.tool_use_id), toolInput: parse<Record<string, unknown>>(r.tool_input), otherResults: parse<ToolResultBlock[]>(r.other_results), createdAt: ms(r.created_at), expiresAt: ms(r.expires_at) }
      : null;
  }
  async setPending(a: PendingAction) {
    await this.sql`INSERT INTO sv_ai.pending_action (action_id, conversation_id, tool_name, tool_use_id, tool_input, other_results, created_at, expires_at)
      VALUES (${a.actionId}, ${a.conversationId}, ${a.toolName}, ${a.toolUseId}, ${a.toolInput}, ${a.otherResults}, ${new Date(a.createdAt)}, ${new Date(a.expiresAt)})`;
  }
  async clearPending(conversationId: string) {
    await this.sql`DELETE FROM sv_ai.pending_action WHERE conversation_id = ${conversationId}`;
  }
  async purge(before: number) {
    return ((await this.sql`DELETE FROM sv_ai.conversation WHERE updated_at < ${new Date(before)} RETURNING id`) as Row[]).length;
  }
}
