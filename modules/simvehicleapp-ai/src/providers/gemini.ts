import { failed, type LlmProvider, type Message, sseEvents, type TextBlock, type ToolUseBlock } from "./types.ts";

/**
 * Gemini native API (`models/{model}:streamGenerateContent?alt=sse`, header `x-goog-api-key`) — never the
 * OpenAI-compatible layer, which refuses the new `AQ.` keys (ADR-0030 §2 Notes).
 */
export function geminiProvider(opts: { apiKey: string; model: string; baseUrl?: string }): LlmProvider {
  const base = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  return {
    name: "gemini",
    model: opts.model,
    async streamTurn(req) {
      const res = await fetch(`${base}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        signal: req.signal,
        headers: { "x-goog-api-key": opts.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: toGemini(req.messages),
          ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }] } : {}),
        }),
      });
      if (!res.ok) await failed(res, "gemini");
      let text = "";
      const calls: ToolUseBlock[] = [];
      for await (const { data } of sseEvents(res)) {
        const chunk = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[] } }[] };
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) {
            text += part.text;
            req.onText?.(part.text);
          }
          if (part.functionCall) calls.push({ type: "tool_use", id: `gemini_${calls.length}_${part.functionCall.name}`, name: part.functionCall.name, input: part.functionCall.args ?? {} });
        }
      }
      const content: (TextBlock | ToolUseBlock)[] = [...(text ? [{ type: "text" as const, text }] : []), ...calls];
      return { content, stopReason: calls.length ? "tool_use" : "end_turn" };
    },
  };
}

/** Canonical history ⇒ Gemini contents (`model` role, functionCall/functionResponse parts). */
export function toGemini(messages: readonly Message[]): Record<string, unknown>[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    const role = m.role === "assistant" ? "model" : "user";
    if (typeof m.content === "string") return { role, parts: [{ text: m.content }] };
    const parts = m.content.map((b) => {
      if (b.type === "text") return { text: b.text };
      if (b.type === "tool_use") {
        names.set(b.id, b.name);
        return { functionCall: { name: b.name, args: b.input } };
      }
      return { functionResponse: { name: names.get(b.tool_use_id) ?? "tool", response: { result: b.content, ...(b.is_error ? { error: true } : {}) } } };
    });
    return { role, parts };
  });
}

/** Gemini accepts an OpenAPI subset: drop JSON Schema keywords it rejects. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (["additionalProperties", "$schema", "$id", "$ref", "minProperties", "uniqueItems", "pattern", "const"].includes(k)) continue;
    out[k] = geminiSchema(v);
  }
  return out;
}
