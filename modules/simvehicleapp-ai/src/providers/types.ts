/**
 * Canonical chat shapes (ADR-0030 §2): the content blocks of the Anthropic Messages API are the one
 * internal representation — history, tool schemas and turn results. Every other provider translates its
 * own request/response to and from these shapes in its adapter.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface TurnRequest {
  system: string;
  tools: ToolDef[];
  messages: Message[];
  /** Text as it streams (shown live in the chat). */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  content: (TextBlock | ToolUseBlock)[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export interface LlmProvider {
  name: string;
  model: string;
  streamTurn(req: TurnRequest): Promise<TurnResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Server-sent events of a streaming HTTP response: `{event?, data}` per message. */
export async function* sseEvents(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i = buf.indexOf("\n\n");
    while (i >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { ...(event ? { event } : {}), data: data.join("\n") };
      i = buf.indexOf("\n\n");
    }
  }
}

/** The text of a result (all text blocks). */
export const textOf = (content: readonly ContentBlock[]) =>
  content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

/** Key-shaped strings (OpenAI/Anthropic `sk-…`, Google `AIza…`/`AQ.…`, bearer values) are masked. */
const KEY_SHAPES = [/\bsk-[A-Za-z0-9_-]{8,}/g, /\bAIza[0-9A-Za-z_-]{20,}/g, /\bAQ\.[A-Za-z0-9_.-]{10,}/g, /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi];

/** Provider errors reach the user (SSE `error`): never with a key in them (ADR-0030 §T10). */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  for (const re of KEY_SHAPES) out = out.replace(re, (_m, prefix?: string) => `${typeof prefix === "string" ? prefix : ""}[redacted]`);
  return out;
}

export async function failed(res: Response, provider: string, secrets: readonly (string | undefined)[] = []): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new ProviderError(redactSecrets(`${provider} ${res.status}: ${body.slice(0, 300)}`, secrets), res.status);
}
