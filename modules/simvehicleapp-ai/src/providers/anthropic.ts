import { failed, type LlmProvider, ProviderError, sseEvents, type TextBlock, type ToolUseBlock, type TurnResult } from "./types.ts";

/** Anthropic Messages API, streaming (`POST /v1/messages`, the canonical shapes pass through). */
export function anthropicProvider(opts: { apiKey: string; model: string; baseUrl?: string; maxTokens?: number }): LlmProvider {
  const base = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  return {
    name: "anthropic",
    model: opts.model,
    async streamTurn(req) {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        signal: req.signal,
        headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: opts.model, max_tokens: opts.maxTokens ?? 4096, system: req.system, tools: req.tools, messages: req.messages, stream: true }),
      });
      if (!res.ok) await failed(res, "anthropic", [opts.apiKey]);
      const blocks: ((TextBlock | ToolUseBlock) & { json?: string })[] = [];
      let stop: TurnResult["stopReason"] = "end_turn";
      for await (const { data } of sseEvents(res)) {
        const e = JSON.parse(data) as Record<string, any>;
        if (e.type === "content_block_start") {
          const b = e.content_block;
          blocks[e.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: {}, json: "" } : { type: "text", text: "" };
        } else if (e.type === "content_block_delta") {
          const b = blocks[e.index];
          if (e.delta.type === "text_delta" && b?.type === "text") {
            b.text += e.delta.text;
            req.onText?.(e.delta.text);
          } else if (e.delta.type === "input_json_delta" && b?.type === "tool_use") b.json += e.delta.partial_json;
        } else if (e.type === "message_delta" && e.delta?.stop_reason) {
          stop = e.delta.stop_reason === "tool_use" ? "tool_use" : e.delta.stop_reason === "max_tokens" ? "max_tokens" : "end_turn";
        } else if (e.type === "error") throw new ProviderError(`anthropic: ${e.error?.message ?? "stream error"}`);
      }
      const content = blocks.filter(Boolean).map((b) => {
        if (b.type !== "tool_use") return b;
        const { json, ...rest } = b;
        return { ...rest, input: json ? (JSON.parse(json) as Record<string, unknown>) : {} };
      });
      return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : stop };
    },
  };
}
