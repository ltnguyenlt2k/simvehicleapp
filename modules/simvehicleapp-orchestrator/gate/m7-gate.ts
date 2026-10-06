/**
 * M7 acceptance gate steps (analysis/phases/M07 "Gate"), run by `m7-gate.sh` in a container on the
 * dev stack's sv-internal network against the real orchestrator, workspace, codegen and toolchain.
 * Each step prints `ok …` lines (evidence for docs/reports/M07.md) or exits 1 with `FAIL …`.
 *
 *   STEP=syncode  create project SLUG, SynCode GW-A + GW-B twice (pass, idempotent, incremental)
 *   STEP=fault    SynCode GW-B only while the workspace exits mid-commit; prints the previous generation
 *   STEP=recover  PREV=<gid>: the project is exactly generation PREV again, then SynCode passes
 *   STEP=broken   SynCode with the runtime API renamed in the project: CPP_COMPILE_ERROR on block b2
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const W = process.env.SV_WORKSPACE_URL ?? "http://workspace:4040";
const slug = process.env.SLUG ?? "";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const golden = "/repo/modules/simvehicleapp-contracts/fixtures/golden";

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => {
  const res = await fetch(url, { headers: h });
  if (!res.ok) throw new Error(`${url} ⇒ ${res.status} ${await res.text()}`);
  return res.json();
};

const ids = ["GW-A", "GW-B"];
const graphs = ids.map((id) => JSON.parse(readFileSync(`${golden}/${id}/graph.json`, "utf8")));
const scenarios = ids.map((id, i) => ({ workflowId: graphs[i].workflowId, scenario: Bun.YAML.parse(readFileSync(`${golden}/${id}/scenario.yaml`, "utf8")) }));

type Gen = {
  id: string;
  success?: boolean;
  stage?: string;
  verification: Record<string, string>;
  stages: { name: string; state: string; startedAt?: number; finishedAt?: number }[];
  diagnostics: { code: string; message: string; blockId?: string; nodeId?: string; workflowId?: string; data?: Record<string, unknown> }[];
  generatedFiles: string[];
  editor?: { url: string };
};

const project = async () => (await get(`${O}/projects`)).projects.find((p: { slug: string }) => p.slug === slug);

async function syncode(label: string, body: unknown): Promise<Gen> {
  const p = await project();
  const t = Date.now();
  const res = await fetch(`${O}/projects/${p.id}/generations`, { method: "POST", headers: h, body: JSON.stringify(body) });
  must(res.status === 202, `${label}: queued (${res.status})`);
  const g = await res.json();
  // The SSE stream ends with the generation.
  const log = await (await fetch(`${O}/events?generationId=${g.id}`, { headers: h })).text();
  const lines = log.split("\n").filter((l) => l.startsWith("data: ")).length;
  const done: Gen = await get(`${O}/projects/${p.id}/generations/${g.id}`);
  const dur = (s: Gen["stages"][number]) => (s.finishedAt && s.startedAt ? `${((s.finishedAt - s.startedAt) / 1000).toFixed(1)}s` : "-");
  console.log(`${label}: ${done.id} success=${done.success} stage=${done.stage ?? "-"} verification=${JSON.stringify(done.verification)} ${((Date.now() - t) / 1000).toFixed(0)}s, ${lines} log lines`);
  console.log(`  stages: ${done.stages.map((s) => `${s.name}=${s.state}(${dur(s)})`).join(" ")}`);
  if (!done.success) for (const d of done.diagnostics.slice(0, 5)) console.log(`  ${d.code} block=${d.blockId ?? "-"} node=${d.nodeId ?? "-"} workflow=${d.workflowId ?? "-"} line=${String(d.data?.line ?? "-")}: ${d.message.slice(0, 160)}`);
  return done;
}

const ownedTree = async () =>
  ((await get(`${W}/projects/${slug}/tree`)).files as { path: string; size: number; owned: boolean }[]).filter((f) => f.owned || f.path === "app/AppManifest.json");

switch (process.env.STEP) {
  case "syncode": {
    const created = await fetch(`${O}/projects`, { method: "POST", headers: h, body: JSON.stringify({ slug, name: "Gate M7", language: "cpp", vssRelease: "v4.0" }) });
    must(created.status === 201, `project ${slug} created`);
    let p = await created.json();
    const t0 = Date.now();
    while (p.status === "creating") {
      await Bun.sleep(2000);
      p = await get(`${O}/projects/${p.id}`);
    }
    must(p.status === "ready", `project ready in ${((Date.now() - t0) / 1000).toFixed(0)} s (template + overlay + runtime + VSS, velocitas init offline)`);
    const first = await syncode("SynCode 1", { graphs, scenarios });
    must(first.success && Object.values(first.verification).every((v) => v === "passed"), "GW-A + GW-B: {ir, format, compile, tests} passed with the real toolchain");
    const before = JSON.stringify(await ownedTree());
    const second = await syncode("SynCode 2 (nothing changed)", { graphs, scenarios });
    must(second.success, "second SynCode passes");
    must(JSON.stringify(await ownedTree()) === before, "second SynCode leaves every generated file and the AppManifest identical");
    const b = second.stages.find((s) => s.name === "build")!;
    must(b.finishedAt! - b.startedAt! < 60_000, `incremental build < 60 s (${((b.finishedAt! - b.startedAt!) / 1000).toFixed(1)} s)`);
    must(second.editor?.url.endsWith(`/?folder=/workspace/projects/${slug}`), `editor.url ${second.editor?.url}`);
    break;
  }
  case "fault": {
    const current = (await get(`${W}/projects/${slug}/generations`)).current as string;
    const g = await syncode("SynCode while the workspace dies mid-commit", { graphs: [graphs[1]], scenarios: [scenarios[1]] });
    must(!g.success && g.stage === "write", "the generation fails at the write stage");
    console.log(`PREV=${current}`);
    break;
  }
  case "recover": {
    const prev = process.env.PREV ?? "";
    must((await get(`${W}/projects/${slug}/generations`)).current === prev, `after restart the current generation is still ${prev}`);
    const tree = await ownedTree();
    must(!tree.some((f) => f.path.includes(".old-")), "no half-swapped root left behind");
    const p = await project();
    const record: Gen = await get(`${O}/projects/${p.id}/generations/${prev}`);
    const onDisk = tree.filter((f) => f.owned).map((f) => f.path).sort();
    must(JSON.stringify(onDisk) === JSON.stringify([...record.generatedFiles].sort()), `generated files on disk = files of ${prev} (${onDisk.length})`);
    let same = 0;
    for (const path of onDisk) {
      const now = (await get(`${W}/projects/${slug}/file?path=${encodeURIComponent(path)}`)).content;
      const then = (await get(`${W}/projects/${slug}/generations/${prev}/file?path=${encodeURIComponent(path)}`)).content;
      if (now === then) same++;
    }
    must(same === onDisk.length, "every generated file has the content of that generation (nothing half-written)");
    const again = await syncode("SynCode after recovery", { graphs, scenarios });
    must(again.success, "the project commits and builds again");
    break;
  }
  case "broken": {
    const g = await syncode("SynCode with the runtime API renamed (stableFor)", { graphs, scenarios });
    must(!g.success && g.stage === "build" && g.verification.compile === "failed", "fails at build, compile=failed");
    const d = g.diagnostics.find((x) => x.code === "CPP_COMPILE_ERROR" && x.blockId);
    must(d?.blockId === "b2" && d.nodeId === "n2" && d.workflowId === "gw_a", `CPP_COMPILE_ERROR on block ${d?.blockId} (node ${d?.nodeId}, workflow ${d?.workflowId}) — the Stable for block of GW-A`);
    break;
  }
  default:
    must(false, `unknown STEP ${process.env.STEP}`);
}
