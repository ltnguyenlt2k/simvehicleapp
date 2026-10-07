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

export async function failed(res: Response, provider: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new ProviderError(`${provider} ${res.status}: ${body.slice(0, 300)}`, res.status);
}
