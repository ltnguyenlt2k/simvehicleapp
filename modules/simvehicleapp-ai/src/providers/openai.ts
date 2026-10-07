import { failed, type LlmProvider, type Message, sseEvents, type TextBlock, type ToolUseBlock, type TurnResult } from "./types.ts";

/**
 * OpenAI Chat Completions with tools, streaming — OpenAI, Azure/AI Foundry, OpenRouter, or a self-hosted
 * server speaking the same API (Ollama, LiteLLM, vLLM) by base URL (ADR-0030 §2). Canonical blocks are
 * translated to `messages`/`tool_calls`/`tool` roles and back.
 */
export function openaiProvider(opts: { name?: string; apiKey?: string; model: string; baseUrl: string; extraBody?: Record<string, unknown>; maxTokens?: number }): LlmProvider {
  const base = opts.baseUrl.replace(/\/$/, "");
  return {
    name: opts.name ?? "openai-compatible",
    model: opts.model,
    async streamTurn(req) {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: req.signal,
        headers: { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          max_tokens: opts.maxTokens ?? 4096,
          messages: [{ role: "system", content: req.system }, ...toOpenAi(req.messages)],
          ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
          ...opts.extraBody,
        }),
      });
      if (!res.ok) await failed(res, opts.name ?? "openai-compatible", [opts.apiKey]);
      let text = "";
      const calls: { id: string; name: string; args: string }[] = [];
      let finish = "";
      for await (const { data } of sseEvents(res)) {
        if (data === "[DONE]") break;
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          text += choice.delta.content;
          req.onText?.(choice.delta.content);
        }
        for (const tc of choice.delta?.tool_calls ?? []) {
          const i = tc.index ?? calls.length;
          calls[i] ??= { id: tc.id ?? `call_${i}`, name: "", args: "" };
          if (tc.id) calls[i]!.id = tc.id;
          if (tc.function?.name) calls[i]!.name += tc.function.name;
          if (tc.function?.arguments) calls[i]!.args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      const content: (TextBlock | ToolUseBlock)[] = [];
      if (text) content.push({ type: "text", text });
      for (const c of calls.filter(Boolean)) {
        let input: Record<string, unknown> = {};
        try {
          input = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {};
        } catch {
          input = { _unparsed: c.args };
        }
        content.push({ type: "tool_use", id: c.id, name: c.name, input });
      }
      const stopReason: TurnResult["stopReason"] = calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";
      return { content, stopReason };
    },
  };
}

/** Canonical history ⇒ OpenAI messages (a tool_result becomes a `tool` message). */
export function toOpenAi(messages: readonly Message[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as TextBlock).text).join("");
      const calls = m.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
      // Empty string, not null: Ollama's OpenAI layer rejects null content ("invalid message content type: <nil>").
      out.push({ role: "assistant", content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `ERROR: ${b.content}` : b.content });
      else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
  }
  return out;
}
