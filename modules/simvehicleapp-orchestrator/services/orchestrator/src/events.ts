import type { EventSink } from "./pipeline.ts";
import type { LogLine, Repo } from "./repo.ts";

/**
 * SSE of a generation (`GET /events?generationId=`, ADR-0027): stored lines after Last-Event-ID,
 * then live lines until the generation ends (the stream closes then).
 */
export class EventHub implements EventSink {
  private readonly subs = new Map<string, Set<(l: LogLine | null) => void>>();

  line(id: string, l: LogLine) {
    for (const f of this.subs.get(id) ?? []) f(l);
  }

  end(id: string) {
    for (const f of [...(this.subs.get(id) ?? [])]) f(null);
    this.subs.delete(id);
  }

  subscribe(id: string, f: (l: LogLine | null) => void): () => void {
    const set = this.subs.get(id) ?? new Set();
    set.add(f);
    this.subs.set(id, set);
    return () => set.delete(f);
  }

  /** The SSE response: backlog from the repo, then live; `finished` closes after the backlog. */
  stream(repo: Repo, id: string, afterSeq: number, finished: () => Promise<boolean>, signal: AbortSignal): Response {
    const enc = new TextEncoder();
    let unsubscribe = () => {};
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let closed = false;
        let last = afterSeq;
        let live = false;
        let ended = false;
        const queued: LogLine[] = [];
        const send = (l: LogLine) => {
          if (closed || l.seq <= last) return;
          last = l.seq;
          controller.enqueue(enc.encode(`id: ${l.seq}\nevent: log\ndata: ${JSON.stringify(l)}\n\n`));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          controller.close();
        };
        // Subscribe before reading the backlog: a line emitted meanwhile waits in `queued` (seq dedups).
        unsubscribe = this.subscribe(id, (l) => {
          if (l === null) {
            ended = true;
            if (live) close();
          } else if (live) send(l);
          else queued.push(l);
        });
        for (const l of await repo.events(id, afterSeq)) send(l);
        for (const l of queued) send(l);
        live = true;
        if (ended || (await finished())) {
          for (const l of await repo.events(id, last)) send(l);
          close();
        }
        signal.addEventListener("abort", close);
      },
      cancel: () => unsubscribe(),
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  }
}
