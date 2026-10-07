import { type LlmProvider, ProviderError } from "./providers/types.ts";
import type { ContentBlock, Message, TextBlock, ToolResultBlock, ToolUseBlock } from "./providers/types.ts";
import type { PendingAction, Store } from "./store.ts";
import { missingRequired, type Proposal, runTool, type Tool, type ToolContext } from "./tools.ts";

/**
 * Agent loop (ADR-0030 §6, §11, M10-T04): one chat turn = up to `maxSteps` LLM calls. Safe tools run at
 * once; a sensitive tool with every required field becomes the conversation's one pending action (TTL)
 * and ends the turn; one missing a field is a tool error the LLM sees in the same turn. The turn streams
 * events: text deltas, tool calls/results, the latest WorkflowPatch proposal, the pending action.
 */

export type AgentEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "tool"; data: { id: string; name: string; input: Record<string, unknown> } }
  | { event: "tool_result"; data: { id: string; name: string; isError: boolean; text: string; structured?: Record<string, unknown> } }
  | { event: "proposal"; data: Proposal }
  | { event: "pending_action"; data: { actionId: string; toolName: string; toolInput: Record<string, unknown>; description: string; expiresAt: number } }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { conversationId: string; pending: boolean; steps: number } };

export interface AgentDeps {
  provider: LlmProvider;
  store: Store;
  /** Tools of this turn (registry + `ext.*` of the MCP clients). */
  tools: Tool[];
  sensitive(name: string): boolean;
  system: string;
  maxSteps: number;
  newId(): string;
  now(): number;
  pendingTtlMs: number;
  log?: { warn(msg: string, data?: Record<string, unknown>): void };
}

const RESULT_TEXT_MAX = 8000;
/** Runtime reminders added to the history (not the user's words: hidden from the visible history). */
export const NUDGE_PREFIX = "[assistant runtime] ";
const MAX_NUDGES = 2;

/** A user message after `history`: merged into a trailing user message (providers want alternation). */
function withUser(history: Message[], content: ContentBlock[]): { messages: Message[]; appended: Message } {
  const last = history.at(-1);
  if (last?.role === "user") {
    const merged: Message = { role: "user", content: [...(typeof last.content === "string" ? [{ type: "text", text: last.content } as TextBlock] : last.content), ...content] };
    return { messages: [...history.slice(0, -1), merged], appended: { role: "user", content } };
  }
  return { messages: [...history, { role: "user", content }], appended: { role: "user", content } };
}

const blocksOf = (m: Message): ContentBlock[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content);

/** History as providers accept it: consecutive messages of one role merged (stored turns may end on a user message). */
export function normalizeHistory(history: readonly Message[]): Message[] {
  const out: Message[] = [];
  for (const m of history) {
    const last = out.at(-1);
    if (last && last.role === m.role) out[out.length - 1] = { role: m.role, content: [...blocksOf(last), ...blocksOf(m)] };
    else out.push(m);
  }
  return out;
}

/** Runs the turn from `userContent` (the user's text, or tool results after a confirmation). */
export async function runTurn(d: AgentDeps, conversationId: string, userContent: ContentBlock[], ctx: ToolContext, emit: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const byName = new Map(d.tools.map((t) => [t.name, t]));
  const history = normalizeHistory(await d.store.messages(conversationId));
  let { messages, appended } = withUser(history, userContent);
  await d.store.append(conversationId, [appended]);
  let proposal: Proposal | null = null;
  let steps = 0;
  let nudges = 0;
  let workedOnWorkflow = false;
  try {
    while (steps < d.maxSteps) {
      steps++;
      const request = { system: d.system, tools: d.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })), messages, onText: (delta: string) => emit({ event: "text", data: { delta } }), signal };
      // A provider error before anything streamed (5xx — e.g. Ollama failing to parse the model's
      // tool call) is retried once; the user sees nothing of the failed attempt.
      const result = await d.provider.streamTurn(request).catch((e: unknown) => {
        if (e instanceof ProviderError && (e.status ?? 0) >= 500 && !signal?.aborted) return d.provider.streamTurn(request);
        throw e;
      });
      const assistant: Message = { role: "assistant", content: result.content.length ? result.content : [{ type: "text", text: "" }] };
      messages = [...messages, assistant];
      await d.store.append(conversationId, [assistant]);
      const uses = result.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      if (!uses.length) {
        // Small models often describe a plan instead of proposing it, or stop on an invalid proposal:
        // remind them (bounded) while steps remain (M10-T09 eval).
        const said = result.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        // Announcing work without doing it ("I will create…", "Tôi sẽ tạo…") counts as planned too.
        const planned = workedOnWorkflow || /\bsv_[a-z_]+/.test(said) || /\b(I will|I'll|let me|I need to|first,? I)\b|(tôi|mình) (sẽ|cần)|trước tiên/i.test(said);
        const reminder =
          proposal && !proposal.valid
            ? "The last proposal still has error diagnostics. Fix them and call workflow_propose_patch again with the complete ops."
            : !proposal && planned && ctx.workflow
              ? "Do not describe the plan: call workflow_propose_patch now with the complete ops (trigger block first, then the connected blocks)."
              : null;
        if (!reminder || nudges >= MAX_NUDGES || steps >= d.maxSteps) break;
        nudges++;
        ({ messages, appended } = withUser(messages, [{ type: "text", text: `${NUDGE_PREFIX}${reminder}` }]));
        await d.store.append(conversationId, [appended]);
        continue;
      }
      if (uses.some((u) => u.name === "vss_search" || u.name === "vss_get_signal" || u.name === "blocks_list" || u.name === "workflow_propose_patch")) workedOnWorkflow = true;

      const results: ToolResultBlock[] = [];
      let pendingUse: ToolUseBlock | null = null;
      for (const use of uses) {
        const tool = byName.get(use.name);
        if (!tool) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: `Unknown tool ${use.name}.`, is_error: true });
          continue;
        }
        if (d.sensitive(use.name)) {
          const missing = missingRequired(tool, use.input);
          if (missing.length) {
            // Never wait for a confirmation of an incomplete call: the LLM asks or fixes it now (ADR-0030 §6).
            results.push({ type: "tool_result", tool_use_id: use.id, content: `Missing required field(s): ${missing.join(", ")}. Ask the user or fill them, then call ${use.name} again.`, is_error: true });
            continue;
          }
          if (pendingUse) {
            results.push({ type: "tool_result", tool_use_id: use.id, content: "One action needs the user's confirmation already: call this one after it.", is_error: true });
            continue;
          }
          pendingUse = use;
          continue;
        }
        emit({ event: "tool", data: { id: use.id, name: use.name, input: use.input } });
        const outcome = await runTool(tool, use.input, ctx);
        if (outcome.isError) d.log?.warn("tool error", { tool: use.name, input: use.input, error: outcome.text.slice(0, 500) });
        if (outcome.proposal) proposal = outcome.proposal;
        const text = outcome.text.length > RESULT_TEXT_MAX ? `${outcome.text.slice(0, RESULT_TEXT_MAX)}…(truncated)` : outcome.text;
        emit({ event: "tool_result", data: { id: use.id, name: use.name, isError: Boolean(outcome.isError), text: text.slice(0, 2000), ...(outcome.structured ? { structured: outcome.structured } : {}) } });
        results.push({ type: "tool_result", tool_use_id: use.id, content: text, ...(outcome.isError ? { is_error: true } : {}) });
      }

      if (pendingUse) {
        const action: PendingAction = { actionId: d.newId(), conversationId, toolName: pendingUse.name, toolUseId: pendingUse.id, toolInput: pendingUse.input, otherResults: results, createdAt: d.now(), expiresAt: d.now() + d.pendingTtlMs };
        await d.store.setPending(action);
        if (proposal) emit({ event: "proposal", data: proposal });
        emit({ event: "pending_action", data: { actionId: action.actionId, toolName: action.toolName, toolInput: action.toolInput, description: byName.get(action.toolName)?.description ?? "", expiresAt: action.expiresAt } });
        emit({ event: "done", data: { conversationId, pending: true, steps } });
        return;
      }
      ({ messages, appended } = withUser(messages, results));
      await d.store.append(conversationId, [appended]);
      if (steps >= d.maxSteps) emit({ event: "text", data: { delta: `\n(Stopped after ${d.maxSteps} steps.)` } });
    }
  } catch (e) {
    d.log?.warn("turn failed", { conversationId, error: (e as Error).message });
    emit({ event: "error", data: { message: (e as Error).message } });
  }
  if (proposal) emit({ event: "proposal", data: proposal });
  emit({ event: "done", data: { conversationId, pending: false, steps } });
}

/** Confirmation of the pending action: runs it (the user's edited input wins) and continues the turn. */
export async function confirmAction(d: AgentDeps, action: PendingAction, editedInput: Record<string, unknown> | undefined, ctx: ToolContext, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  await d.store.clearPending(action.conversationId);
  const tool = d.tools.find((t) => t.name === action.toolName);
  const input = editedInput ?? action.toolInput;
  let result: ToolResultBlock;
  if (!tool) result = { type: "tool_result", tool_use_id: action.toolUseId, content: `Tool ${action.toolName} is no longer available.`, is_error: true };
  else {
    emit({ event: "tool", data: { id: action.toolUseId, name: action.toolName, input } });
    const outcome = await runTool(tool, input, ctx);
    emit({ event: "tool_result", data: { id: action.toolUseId, name: action.toolName, isError: Boolean(outcome.isError), text: outcome.text.slice(0, 2000), ...(outcome.structured ? { structured: outcome.structured } : {}) } });
    result = { type: "tool_result", tool_use_id: action.toolUseId, content: `${outcome.text}${editedInput ? " (the user edited the input before confirming)" : ""}`, ...(outcome.isError ? { is_error: true } : {}) };
  }
  await runTurn(d, action.conversationId, [...action.otherResults, result], ctx, emit, signal);
}

/** Cancellation: the LLM learns the user declined, and answers. */
export async function cancelAction(d: AgentDeps, action: PendingAction, ctx: ToolContext, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  await d.store.clearPending(action.conversationId);
  await runTurn(d, action.conversationId, [...action.otherResults, { type: "tool_result", tool_use_id: action.toolUseId, content: "The user cancelled this action. Do not retry it unless asked.", is_error: true }], ctx, emit, signal);
}
