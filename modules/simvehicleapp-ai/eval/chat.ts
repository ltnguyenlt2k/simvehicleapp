/** One chat turn against the running ai-assistant (sv-internal network): prints events, returns the proposal. */
const AI = process.env.SV_AI_URL ?? "http://ai-assistant:4300";
export interface TurnOutput {
  text: string;
  tools: string[];
  proposal?: { valid: boolean; graph: { blocks: { id: string; type: string; name: string; props: Record<string, unknown> }[]; edges: { from: string; fromHandle: string; to: string }[] }; diagnostics: { severity: string; code: string; message: string }[] };
  pending?: { toolName: string; toolInput: Record<string, unknown> };
  error?: string;
  ms: number;
}
export async function chat(message: string, opts: { user?: string; release?: string; workflowId?: string; graph?: unknown; projectId?: string } = {}): Promise<TurnOutput> {
  const t0 = Date.now();
  const res = await fetch(`${AI}/chat`, {
    method: "POST",
    headers: { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "x-sv-user-id": opts.user ?? "eval", "content-type": "application/json" },
    body: JSON.stringify({ message, context: { workflow: { workflowId: opts.workflowId ?? "wf_eval", name: "Eval", vssRelease: opts.release ?? "v4.0", ...(opts.graph ? { graph: opts.graph } : {}) }, ...(opts.projectId ? { project: { id: opts.projectId, vssRelease: opts.release ?? "v4.0" } } : {}) } }),
  });
  if (!res.ok) return { text: "", tools: [], error: `${res.status} ${await res.text()}`, ms: Date.now() - t0 };
  const out: TurnOutput = { text: "", tools: [], ms: 0 };
  for (const block of (await res.text()).split("\n\n")) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (!ev || !data) continue;
    const d = JSON.parse(data);
    if (ev === "text") out.text += d.delta;
    if (ev === "tool") out.tools.push(`${d.name} ${JSON.stringify(d.input).slice(0, 300)}`);
    if (ev === "tool_result" && process.env.SV_EVAL_VERBOSE) out.tools.push(`  ⇒ ${d.isError ? "ERROR " : ""}${String(d.text).slice(0, 400).replace(/\n/g, " | ")}`);
    if (ev === "proposal") out.proposal = d;
    if (ev === "pending_action") out.pending = d;
    if (ev === "error") out.error = d.message;
  }
  out.ms = Date.now() - t0;
  return out;
}
if (import.meta.main) {
  const r = await chat(process.argv[2] ?? "Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy");
  console.log(JSON.stringify({ ms: r.ms, tools: r.tools, text: r.text, error: r.error, valid: r.proposal?.valid, blocks: r.proposal?.graph.blocks, edges: r.proposal?.graph.edges, diagnostics: r.proposal?.diagnostics }, null, 1));
}
