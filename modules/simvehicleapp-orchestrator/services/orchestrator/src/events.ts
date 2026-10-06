import type { EventSink } from "./pipeline.ts";
import type { LogLine, RunEvent } from "./repo.ts";

/**
 * SSE of a generation or a run (`GET /events?generationId=|runId=`, ADR-0027 §2): stored events after
 * Last-Event-ID, then live events until the generation/run ends (the stream closes then). Generations
 * send `event: log` (LogLine v1); runs send `log` and `trace` (TraceEvent v1) in one seq space.
 */

export interface StreamItem {
  seq: number;
  event: "log" | "trace";
  data: unknown;
}

export const itemOfLine = (l: LogLine): StreamItem => ({ seq: l.seq, event: "log", data: l });
export const itemOfRunEvent = (e: RunEvent): StreamItem => ({ seq: e.seq, event: e.kind, data: e.body });

export class EventHub implements EventSink {
  private readonly subs = new Map<string, Set<(items: StreamItem[] | null) => void>>();

  /** EventSink of the SynCode pipeline. */
  line(id: string, l: LogLine) {
    this.publish(id, [itemOfLine(l)]);
  }

  publish(id: string, items: StreamItem[]) {
    if (items.length) for (const f of this.subs.get(id) ?? []) f(items);
  }

  end(id: string) {
    for (const f of [...(this.subs.get(id) ?? [])]) f(null);
    this.subs.delete(id);
  }

  subscribe(id: string, f: (items: StreamItem[] | null) => void): () => void {
    const set = this.subs.get(id) ?? new Set();
    set.add(f);
    this.subs.set(id, set);
    return () => set.delete(f);
  }

  /** The SSE response: backlog (stored events after `afterSeq`), then live; `finished` closes after the backlog. */
  stream(id: string, afterSeq: number, backlog: (after: number) => Promise<StreamItem[]>, finished: () => Promise<boolean>, signal: AbortSignal): Response {
    const enc = new TextEncoder();
    let unsubscribe = () => {};
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let last = afterSeq;
        let live = false;
        let ended = false;
        const queued: StreamItem[] = [];
        const send = (items: StreamItem[]) => {
          let text = "";
          for (const it of items) {
            if (it.seq <= last) continue;
            last = it.seq;
            text += `id: ${it.seq}\nevent: ${it.event}\ndata: ${JSON.stringify(it.data)}\n\n`;
          }
          if (text && !closed) controller.enqueue(enc.encode(text));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          controller.close();
        };
        // Subscribe before reading the backlog: events emitted meanwhile wait in `queued` (seq dedups).
        unsubscribe = this.subscribe(id, (items) => {
          if (items === null) {
            ended = true;
            if (live) close();
          } else if (live) send(items);
          else queued.push(...items);
        });
        // The backlog may be long (a run keeps 20 000 events): pages of 5 000.
        for (;;) {
          const page = await backlog(last);
          send(page);
          if (page.length < 5000) break;
        }
        send(queued.sort((a, b) => a.seq - b.seq));
        live = true;
        if (ended || (await finished())) {
          send(await backlog(last));
          close();
        }
        signal.addEventListener("abort", close);
      },
      cancel: () => {
        closed = true;
        unsubscribe();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }
}
