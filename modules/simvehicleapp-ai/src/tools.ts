import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyPatch, emptyGraph, normalizeName, repairOps, type PatchOp, patchSummary, referencesByName, type WorkflowGraph, type WorkflowPatch } from "./patch.ts";
import type { ToolDef } from "./providers/types.ts";
import { ServiceError, type Services } from "./services.ts";

/**
 * Tool registry of the `simvehicleapp` MCP server and of the chat agent (ADR-0030 §3, §6, §10,
 * analysis/09 §4). Each tool is statically in exactly one of SAFE_TOOL_NAMES (runs on its own) or
 * SENSITIVE_TOOL_NAMES (writes, runs real things or is costly: always confirmed first). No tool writes
 * or returns target-language code (§8); the only way to change a workflow is a WorkflowPatch proposal.
 */

export const SAFE_TOOL_NAMES = new Set([
  "vss_search",
  "vss_get_signal",
  "blocks_list",
  "workflow_get",
  "workflow_propose_patch",
  "workflow_validate",
  "workflow_simulate",
  "diagnostics_explain",
  "run_logs",
]);
export const SENSITIVE_TOOL_NAMES = new Set(["project_syncode", "run_start", "run_stop", "signal_set"]);

/** What the studio sends with a chat turn: the workflow open in the editor and its project. */
export interface ToolContext {
  userId: string;
  conversationId: string;
  workflow?: { workflowId: string; name?: string; vssRelease: string; graph?: WorkflowGraph };
  project?: { id: string; vssRelease: string; graphs?: WorkflowGraph[]; scenarios?: { workflowId: string; scenario: unknown }[] };
}

export interface Proposal {
  patch: WorkflowPatch;
  graph: WorkflowGraph;
  diagnostics: Diagnostic[];
  summary: ReturnType<typeof patchSummary>;
  valid: boolean;
}

export interface ToolOutcome {
  text: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
  proposal?: Proposal;
}

export interface Tool extends ToolDef {
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  blockId?: string;
  field?: string;
}

interface BlockSpec {
  type: string;
  title: string;
  category: string;
  props: { name: string; kind: string; required?: boolean; default?: unknown; enum?: unknown[]; valueType?: string }[];
  outputs?: { name: string; type: string }[];
  handles?: { in?: string[]; out?: string[] };
}

const CATALOG = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@simvehicleapp/contracts/schemas/diagnostics-catalog.v1.json")), "utf8")) as { codes: { code: string; severity: string; stage: string; title: string; adr?: string }[] };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const err = (text: string): ToolOutcome => ({ text, isError: true });
const compact = (v: unknown, max = 6000) => {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…(truncated)` : s;
};

/** Block catalog (compiler `GET /blocks`), cached: the system prompt and `blocks_list` read it. */
export class BlockCatalog {
  private cache: Promise<BlockSpec[]> | null = null;
  constructor(private readonly services: Services) {}
  specs(): Promise<BlockSpec[]> {
    this.cache ??= (this.services.get("compiler", "/blocks") as Promise<{ blocks: BlockSpec[] }>).then((r) => r.blocks).catch((e) => {
      this.cache = null;
      throw e;
    });
    return this.cache;
  }
  /** One line per block: type, title, props (kind, required), outputs and handles. */
  async summary(): Promise<string> {
    return (await this.specs())
      .map((b) => {
        const props = b.props.map((p) => `${p.name}:${p.kind}${p.enum ? `(${p.enum.join("|")})` : ""}${p.required ? "!" : ""}${p.default !== undefined ? `=${JSON.stringify(p.default)}` : ""}`).join(", ");
        const outs = (b.outputs ?? []).map((o) => `${o.name}:${o.type}`).join(", ");
        return `- ${b.type} — ${b.title} [${b.category}] props {${props}}${outs ? ` outputs {${outs}}` : ""} handles in [${(b.handles?.in ?? []).join(",")}] out [${(b.handles?.out ?? []).join(",")}]`;
      })
      .join("\n");
  }
}

const OP_SCHEMA = {
  type: "object",
  description:
    'One WorkflowPatch v1 op: {"op":"add_block","ref":"t1","type":"sv_…","name":"…","props":{…}} | {"op":"connect","from":"t1","fromHandle":"source","to":"c1","toHandle":"target"} | {"op":"set_props","block":"b2","props":{…}} | {"op":"remove_block","block":"b9"}',
  properties: {
    op: { type: "string", enum: ["add_block", "connect", "set_props", "remove_block"] },
    ref: { type: "string" },
    type: { type: "string" },
    name: { type: "string" },
    props: { type: "object" },
    parentId: { type: "string" },
    from: { type: "string" },
    fromHandle: { type: "string" },
    to: { type: "string" },
    toHandle: { type: "string" },
    block: { type: "string" },
  },
  required: ["op"],
};

export function createTools(services: Services, blocks: BlockCatalog): Tool[] {
  const releaseOf = (ctx: ToolContext, input?: Record<string, unknown>) => str(input?.release) ?? ctx.workflow?.vssRelease ?? ctx.project?.vssRelease ?? "v4.0";
  /** The draft the chat works on: the editor's graph, else an empty one. */
  const draft = (ctx: ToolContext): WorkflowGraph | null =>
    ctx.workflow ? (ctx.workflow.graph ?? emptyGraph(ctx.workflow.workflowId, ctx.workflow.name ?? "Workflow", ctx.workflow.vssRelease)) : null;
  const verify = async (graph: WorkflowGraph): Promise<Diagnostic[]> => ((await services.post("compiler", "/compile", { graph, mode: "verify" })) as { diagnostics: Diagnostic[] }).diagnostics;
  const projectId = (ctx: ToolContext, input: Record<string, unknown>) => str(input.projectId) ?? ctx.project?.id;

  const tools: Tool[] = [
    {
      name: "vss_search",
      description: "Search VSS signals of the workflow's release by words or path fragment. Returns path, kind (sensor/actuator/attribute), datatype, unit.",
      input_schema: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ["sensor", "actuator", "attribute", "branch"] }, release: { type: "string" } }, required: ["query"] },
      async run(input, ctx) {
        type Node = { path: string; kind: string; datatype?: string; unit?: string; description?: string; allowed?: unknown[] };
        const search = async (query: string) => {
          const q = new URLSearchParams({ release: releaseOf(ctx, input), q: query.slice(0, 200), ...(str(input.type) ? { type: str(input.type)! } : {}) });
          return ((await services.get("catalog", `/search?${q}`)) as { nodes: Node[] }).nodes.filter((n) => n.kind !== "branch");
        };
        const query = String(input.query ?? "").trim();
        let nodes = await search(query);
        if (!nodes.length) {
          // A guessed path ("Vehicle.Battery.Soc") or several words: search each word, rank by matches.
          const words = [...new Set(query.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 2 && !/^vehicle$/i.test(w)))].slice(0, 5);
          const hits = new Map<string, { node: Node; n: number }>();
          for (const w of words) for (const node of await search(w)) hits.set(node.path, { node, n: (hits.get(node.path)?.n ?? 0) + 1 });
          nodes = [...hits.values()].sort((a, b) => b.n - a.n || a.node.path.length - b.node.path.length).map((h) => h.node);
        }
        nodes = nodes.slice(0, 15);
        if (!nodes.length) return { text: `No signal matches "${input.query}". Try other words (English VSS names: Speed, StateOfCharge, IsMoving…).` };
        return { text: nodes.map((n) => `${n.path} — ${n.kind}${n.datatype ? ` ${n.datatype}` : ""}${n.unit ? ` [${n.unit}]` : ""}${n.allowed ? ` allowed ${JSON.stringify(n.allowed)}` : ""}: ${(n.description ?? "").slice(0, 120)}`).join("\n") };
      },
    },
    {
      name: "vss_get_signal",
      description: "Full metadata of one VSS path (datatype, unit, min/max, allowed values, access).",
      input_schema: { type: "object", properties: { path: { type: "string" }, release: { type: "string" } }, required: ["path"] },
      async run(input, ctx) {
        const q = new URLSearchParams({ release: releaseOf(ctx, input), paths: String(input.path) });
        const r = (await services.get("catalog", `/nodes?${q}`)) as { nodes: unknown[]; unknown?: string[] };
        if (!r.nodes.length) return err(`${input.path} is not a signal of VSS ${releaseOf(ctx, input)}`);
        return { text: compact(r.nodes[0], 2000) };
      },
    },
    {
      name: "blocks_list",
      description: "The vehicle blocks a workflow can use: type, props (kind, required ! and defaults), outputs, handles.",
      input_schema: { type: "object", properties: {} },
      async run() {
        return { text: await blocks.summary() };
      },
    },
    {
      name: "workflow_get",
      description: "The workflow open in the editor as WorkflowGraph v1 (blocks with ids, names, props; edges with handles).",
      input_schema: { type: "object", properties: { workflowId: { type: "string" } } },
      async run(input, ctx) {
        const g = draft(ctx);
        if (!g) return err("No workflow is open: workflow_get works in the studio chat of a workflow.");
        if (str(input.workflowId) && input.workflowId !== g.workflowId) return err(`Only the open workflow ${g.workflowId} is available.`);
        return { text: compact(g, 12000) };
      },
    },
    {
      name: "workflow_propose_patch",
      description:
        "Propose a change to the open workflow as WorkflowPatch v1 ops, applied to the workflow as it is now (each call replaces the previous proposal: send the complete set of ops). The patch is validated by the compiler; fix any error diagnostic by proposing again. The user accepts it in the editor.",
      input_schema: { type: "object", properties: { ops: { type: "array", minItems: 1, items: OP_SCHEMA }, rationale: { type: "string" } }, required: ["ops"] },
      async run(input, ctx) {
        const base = draft(ctx);
        if (!base) return err("No workflow is open: a patch needs the workflow open in the editor.");
        // Some models send the ops array as a JSON string.
        let opsIn: unknown = input.ops;
        if (typeof opsIn === "string") {
          try {
            opsIn = JSON.parse(opsIn);
          } catch {
            /* reported below */
          }
        }
        const raw = Array.isArray(opsIn) ? (opsIn as PatchOp[]) : [];
        if (!raw.length) return err("ops must be a non-empty array of WorkflowPatch v1 ops.");
        const specs = await blocks.specs().catch(() => [] as BlockSpec[]);
        const title = (t: string) => specs.find((s) => s.type === t)?.title ?? t;
        const repaired = repairOps(base, raw, specs);
        const ops = referencesByName(base, repaired.ops, title);
        const { graph, problems } = applyPatch(base, ops, title);
        if (problems.length) return err(`The patch cannot be applied:\n${problems.join("\n")}`);
        const compiled = await verify(graph);
        // The assistant's bar is higher than "compiles": every block it adds runs, and only real props are set.
        const touched = new Set(ops.flatMap((o) => (o.op === "add_block" ? [o.ref] : o.op === "set_props" ? [o.block] : [])));
        const extra: Diagnostic[] = [];
        for (const b of graph.blocks.filter((x) => touched.has(x.id))) {
          const spec = specs.find((s) => s.type === b.type);
          const unknown = spec ? Object.keys(b.props).filter((k) => !spec.props.some((p) => p.name === k)) : [];
          if (unknown.length) extra.push({ code: "BLOCK_PROPERTY_INVALID", severity: "error", blockId: b.id, message: `${b.type} has no prop ${unknown.join(", ")} (its props: ${spec!.props.map((p) => p.name).join(", ")})` });
        }
        const diagnostics = [
          ...compiled.map((d) => (d.code === "BLOCK_UNREACHABLE" && d.blockId && touched.has(d.blockId) ? { ...d, severity: "error", message: `${d.message}: connect it (connect op from the previous block's output handle)` } : d)),
          ...extra,
        ];
        const errors = diagnostics.filter((d) => d.severity === "error");
        const patch: WorkflowPatch = { patchVersion: "1.0.0", workflowId: base.workflowId, baseRevision: base.revision ?? 0, ops, ...(str(input.rationale) ? { rationale: str(input.rationale) } : {}) };
        const proposal: Proposal = { patch, graph, diagnostics, summary: patchSummary(base, graph), valid: errors.length === 0 };
        const names = graph.blocks.map((b) => `${b.id} "${b.name}" (${b.type})`).join(", ");
        // Concrete help for small models: the references that exist, and the connect ops that are missing.
        const refs = graph.blocks
          .map((b) => ({ b, outs: specs.find((s) => s.type === b.type)?.outputs ?? [] }))
          .filter((x) => x.outs.length)
          .map((x) => `${x.outs.map((o) => `<${normalizeName(x.b.name)}.${o.name}>`).join(" ")} (${x.b.name})`)
          .join("; ");
        const hasIn = new Set(graph.edges.map((e) => e.to));
        const isTrigger = (t: string) => t.startsWith("sv_on_");
        const lonely = graph.blocks.filter((b) => !isTrigger(b.type) && !hasIn.has(b.id) && !b.parentId && touched.has(b.id));
        const hints = [
          ...lonely.map((b) => {
            const prev = graph.blocks.filter((x) => x.id !== b.id && !graph.edges.some((e) => e.from === x.id)).at(-1) ?? graph.blocks.find((x) => isTrigger(x.type));
            const handle = prev ? (specs.find((s) => s.type === prev.type)?.handles?.out?.[0] ?? "source") : "source";
            return prev ? `${b.id} has no incoming connection: add {"op":"connect","from":"${prev.id}","fromHandle":"${handle}","to":"${b.id}"}` : `${b.id} has no incoming connection`;
          }),
          ...(errors.some((d) => d.code === "HANDLE_UNKNOWN" && graph.blocks.some((b) => b.id === d.blockId && isTrigger(b.type)))
            ? ["Triggers (sv_on_…) have no input: connect FROM the trigger to the next block, never into it."]
            : []),
          ...(errors.some((d) => d.code === "BLOCK_PROPERTY_INVALID" && /has no prop (condition|when|if)\b/.test(d.message))
            ? ['Only sv_if (and sv_stable_for) take a condition: put an sv_if before the block and connect its "then" output to it.']
            : []),
          ...(errors.some((d) => d.code === "CONTROL_FLOW_CYCLE") ? ["Edges go forward from the trigger: never connect a block back to the trigger or to an earlier block."] : []),
          ...(errors.some((d) => d.code === "EXPR_SYNTAX")
            ? ['Text in an expression needs double quotes ("RED", "#FF0000"); use the signal\'s allowed values when it has them.']
            : []),
          ...(errors.some((d) => d.code === "EXPR_UNKNOWN_REF") ? [`References that exist: ${refs || "(none: add a trigger first)"}; VSS values are <Vehicle.Path>.`] : []),
        ];
        const fixed = repaired.fixes.length ? `Auto-fixed: ${repaired.fixes.join("; ")}.\n` : "";
        return {
          text: fixed + (errors.length
            ? `Proposal has ${errors.length} error(s) — fix them and propose again with the complete ops:\n${errors.map((d) => `- ${d.code}${d.blockId ? ` on ${d.blockId}` : ""}${d.field ? `.${d.field}` : ""}: ${d.message}`).join("\n")}\n${hints.length ? `How to fix:\n${hints.map((x) => `- ${x}`).join("\n")}\n` : ""}Blocks: ${names}`
            : `Proposal is valid (${diagnostics.length} warning/info). It is shown to the user to accept. Blocks: ${names}`),
          structured: { patch, diagnostics, valid: proposal.valid },
          proposal,
        };
      },
    },
    {
      name: "workflow_validate",
      description: "Run every compiler check on the open workflow (or on draftGraph) and return the diagnostics.",
      input_schema: { type: "object", properties: { draftGraph: { type: "object" } } },
      async run(input, ctx) {
        const g = (input.draftGraph as WorkflowGraph | undefined) ?? draft(ctx);
        if (!g) return err("No workflow to validate: pass draftGraph or open a workflow.");
        const diagnostics = await verify(g);
        return { text: diagnostics.length ? diagnostics.map((d) => `- ${d.severity} ${d.code}${d.blockId ? ` on ${d.blockId}` : ""}: ${d.message}`).join("\n") : "No problems.", structured: { diagnostics } };
      },
    },
    {
      name: "workflow_simulate",
      description: "Simulate the open workflow (or draftGraph) with a scenario v1 (virtual time): returns the vehicle writes and a short trace.",
      input_schema: { type: "object", properties: { scenario: { type: "object" }, draftGraph: { type: "object" } }, required: ["scenario"] },
      async run(input, ctx) {
        const g = (input.draftGraph as WorkflowGraph | undefined) ?? draft(ctx);
        if (!g) return err("No workflow to simulate.");
        const built = (await services.post("compiler", "/compile", { graph: g, mode: "build" })) as { ir?: unknown; diagnostics: Diagnostic[] };
        if (!built.ir) return err(`The workflow does not compile:\n${built.diagnostics.filter((d) => d.severity === "error").map((d) => `- ${d.code}: ${d.message}`).join("\n")}`);
        const sim = (await services.post("compiler", "/simulate", { ir: built.ir, scenario: input.scenario })) as { trace: unknown[]; writes: { t: number; path: string; value: unknown }[]; diagnostics: Diagnostic[] };
        return {
          text: `Writes:\n${sim.writes.map((w) => `t=${w.t} ${w.path} = ${JSON.stringify(w.value)}`).join("\n") || "(none)"}\n${sim.trace.length} trace events.`,
          structured: { writes: sim.writes, trace: sim.trace.slice(0, 200) },
        };
      },
    },
    {
      name: "diagnostics_explain",
      description: "Explain a diagnostic code (what it means, which stage reports it).",
      input_schema: { type: "object", properties: { diagnostic: { type: "string", description: "The code, e.g. TYPE_MISMATCH" } }, required: ["diagnostic"] },
      async run(input) {
        const code = String(input.diagnostic ?? "").trim().toUpperCase();
        const d = CATALOG.codes.find((c) => c.code === code);
        if (!d) return err(`Unknown diagnostic ${code}.`);
        return { text: `${d.code} (${d.severity}, stage ${d.stage}): ${d.title}.${d.adr ? ` See ${d.adr}.` : ""}` };
      },
    },
    {
      name: "run_logs",
      description: "Recent log lines and trace events of a live run (after sinceSeq).",
      input_schema: { type: "object", properties: { runId: { type: "string" }, sinceSeq: { type: "integer" }, filter: { type: "string" } }, required: ["runId"] },
      async run(input) {
        const res = await services.raw("orchestrator", `/events?runId=${encodeURIComponent(String(input.runId))}`, { headers: { "last-event-id": String(input.sinceSeq ?? -1) }, signal: AbortSignal.timeout(1500) });
        if (!res.ok) return err(`No run ${input.runId}.`);
        let text = "";
        try {
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) text += new TextDecoder().decode(chunk);
        } catch {
          // the stream of an active run stays open: read what came within the timeout
        }
        const filter = str(input.filter)?.toLowerCase();
        const lines = text
          .split("\n\n")
          .map((b) => /^data: (.+)$/m.exec(b)?.[1])
          .filter((d): d is string => Boolean(d))
          .map((d) => JSON.parse(d) as { seq: number; msg?: string; ev?: string; node?: string; blockId?: string })
          .map((e) => `${e.seq} ${e.msg ?? `trace ${e.ev}${e.node ? ` ${e.node}` : ""}${e.blockId ? ` (${e.blockId})` : ""}`}`)
          .filter((l) => !filter || l.toLowerCase().includes(filter));
        return { text: lines.slice(-50).join("\n") || "(no events)" };
      },
    },
    {
      name: "project_syncode",
      description: "SynCode: generate the C++ vehicle app of the project from its workflows, build it and run the generated tests (real toolchain). Takes minutes.",
      input_schema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      async run(input, ctx) {
        const id = projectId(ctx, input);
        if (!id || !ctx.project || ctx.project.id !== id || !ctx.project.graphs?.length) return err("SynCode needs the project's workflows from the studio: run it from the chat of a workflow of that project.");
        const g = (await services.post("orchestrator", `/projects/${id}/generations`, { graphs: ctx.project.graphs, ...(ctx.project.scenarios?.length ? { scenarios: ctx.project.scenarios } : {}) })) as { id: string };
        const res = await services.raw("orchestrator", `/events?generationId=${g.id}`, { signal: AbortSignal.timeout(20 * 60_000) });
        await res.text().catch(() => "");
        const done = (await services.get("orchestrator", `/projects/${id}/generations/${g.id}`)) as { success?: boolean; stage?: string; verification: Record<string, string>; diagnostics: Diagnostic[] };
        return {
          text: done.success ? `SynCode passed: ${JSON.stringify(done.verification)}` : `SynCode failed at ${done.stage}: ${done.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")}`,
          structured: { generationId: g.id, verification: done.verification, success: done.success ?? false },
          isError: !done.success,
        };
      },
    },
    {
      name: "run_start",
      description: "Run the app of the project's latest SynCode on the KUKSA databroker of its VSS release.",
      input_schema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] },
      async run(input, ctx) {
        const id = projectId(ctx, input);
        if (!id) return err("projectId is required.");
        const run = (await services.post("orchestrator", `/projects/${id}/runs`, {})) as { id: string; state: string };
        const project = (await services.get("orchestrator", `/projects/${id}`).catch(() => null)) as { editor?: { url: string } } | null;
        return { text: `Run ${run.id} is ${run.state}.`, structured: { runId: run.id, state: run.state, ...(project?.editor ? { editorUrl: project.editor.url } : {}) } };
      },
    },
    {
      name: "run_stop",
      description: "Stop a live run (SIGINT, SIGKILL after 5 s).",
      input_schema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      async run(input) {
        const run = (await services.post("orchestrator", `/runs/${encodeURIComponent(String(input.runId))}/stop`, {})) as { id: string; state: string; exitCode?: number };
        return { text: `Run ${run.id} is ${run.state}.`, structured: { runId: run.id, state: run.state, ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}) } };
      },
    },
    {
      name: "signal_set",
      description: "Set a VSS signal on the databroker of the project's release: a sensor's current value (inject), or an actuator's target with field=target.",
      input_schema: { type: "object", properties: { path: { type: "string" }, value: {}, field: { type: "string", enum: ["value", "target"] } }, required: ["path", "value"] },
      async run(input, ctx) {
        const release = releaseOf(ctx, input);
        const r = (await services.post("signalGateway", "/signals", { release, path: input.path, value: input.value, field: str(input.field) ?? "value" })) as { path: string; value: unknown; ts: number };
        return { text: `${r.path} = ${JSON.stringify(r.value)} on VSS ${release}.`, structured: { path: r.path, value: r.value, ts: r.ts } };
      },
    },
  ];
  for (const t of tools) if (SAFE_TOOL_NAMES.has(t.name) === SENSITIVE_TOOL_NAMES.has(t.name)) throw new Error(`tool ${t.name} must be in exactly one of SAFE/SENSITIVE`);
  return tools;
}

/** A failing tool becomes a tool-error the LLM can read (details are logged by the caller). */
export async function runTool(tool: Tool, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    return await tool.run(input, ctx);
  } catch (e) {
    if (e instanceof ServiceError) return err(e.message);
    return err(`${tool.name} failed: ${(e as Error).message}`);
  }
}

/** Fields required by the tool's JSON Schema that the input lacks (ADR-0030 §6 guard). */
export function missingRequired(tool: ToolDef, input: Record<string, unknown>): string[] {
  const required = (tool.input_schema.required as string[] | undefined) ?? [];
  return required.filter((k) => input[k] === undefined || input[k] === null || input[k] === "");
}
