import { type SvAiEvent, svAiEventSchema } from '@/lib/api/contracts/sv-ai'

/**
 * Reads an assistant turn (SSE over a POST response — EventSource only does GET): each
 * `event:`/`data:` block is checked against the contract and handed over in order. Unknown or
 * malformed blocks are skipped.
 */
export async function readSvAiEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SvAiEvent) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = done ? '' : (blocks.pop() ?? '')
    for (const block of blocks) {
      const event = parseSvAiBlock(block)
      if (event) onEvent(event)
    }
    if (done) return
  }
}

/** One SSE block (`event: name` + `data: json`) as a contract event, or null. */
export function parseSvAiBlock(block: string): SvAiEvent | null {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  try {
    const parsed = svAiEventSchema.safeParse({ event: name, data: JSON.parse(data.join('\n')) })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
