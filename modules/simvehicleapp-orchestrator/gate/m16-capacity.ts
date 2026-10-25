/**
 * M16 capacity gate (ADR-0053, analysis/phases/M16 T10), run step by step by `m16-capacity.sh` in a container on the
 * dev stack's sv-internal network against the real orchestrator, workspace and toolchain-cpp.
 *
 *   STEP=create  two apps ready; a third is refused (host quota); two workflows on one app are refused (app quota)
 *   STEP=build   SynCode GW-A; while one SynCode runs, a second waits and a third replaces it (one queued per app)
 *   STEP=clean   Clean frees exactly the build outputs, sources stay (the shell measures the folder with `du`)
 *   STEP=disk    with the workspace's disk thresholds above the free space: new app 507 HOST_DISK_LOW, SynCode 507
 *   STEP=repair  a failed app is prepared again and becomes ready
 *   STEP=sweep   POST /sweep deletes a failed app older than the TTL; its folder is gone
 *   STEP=delete  Delete frees the folder; a second Delete is 404 (nothing left behind)
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const W = process.env.SV_WORKSPACE_URL ?? "http://workspace:4040";
const slug = process.env.SLUG ?? "";
const [A, B] = [`${slug}-a`, `${slug}-b`];
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const golden = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A";

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
const call = (method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
const app = async (s: string) =>
  ((await get(`${O}/projects`)).projects as { id: string; slug: string; status: string }[]).find((p) => p.slug === s);
const until = async <T>(what: string, read: () => Promise<T>, done: (v: T) => boolean, ms = 600_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await Bun.sleep(2000);
  }
};
const ready = (s: string) => until(`${s} ready`, () => app(s), (p) => p?.status !== "creating");
const settled = (pid: string, gid: string) =>
  until(`generation ${gid}`, () => get(`${O}/projects/${pid}/generations/${gid}`), (g) => !["queued", "running"].includes(g.state));
const codes = async (res: Response) => ((await res.json()) as { code: string; data?: { scope?: string } }[]).map((d) => `${d.code}:${d.data?.scope ?? ""}`);
const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));

switch (process.env.STEP) {
  case "create": {
    for (const s of [A, B]) {
      const r = await call("POST", `${O}/projects`, { slug: s, name: `Gate M16 ${s.slice(-1)}`, language: "cpp", vssRelease: "v4.0" });
      must(r.status === 201, `app ${s} created (${r.status})`);
    }
    for (const s of [A, B]) {
      const p = await ready(s);
      must(p?.status === "ready", `app ${s} ready${p?.status === "ready" ? "" : ` (${p?.status}: ${p?.statusMessage ?? "no message"})`}`);
    }
    const over = await call("POST", `${O}/projects`, { slug: `${slug}-c`, name: "Gate M16 c", language: "cpp", vssRelease: "v4.0" });
    must(over.status === 409 && (await codes(over)).includes("APP_QUOTA_EXCEEDED:host"), `a third app is refused: host quota (${over.status})`);
    const a = (await app(A))!;
    const two = await call("PUT", `${O}/projects/${a.id}/workflows`, {
      workflows: [
        { simWorkflowId: "wf-1", enabled: true },
        { simWorkflowId: "wf-2", enabled: true },
      ],
    });
    must(two.status === 409 && (await codes(two)).includes("APP_QUOTA_EXCEEDED:app"), `two workflows in one app are refused: app quota (${two.status})`);
    break;
  }
  case "build": {
    const a = (await app(A))!;
    const first = await (await call("POST", `${O}/projects/${a.id}/generations`, { graphs: [graph] })).json();
    const g = await settled(a.id, first.id);
    must(g.success, `SynCode GW-A on ${A} (${g.state}${g.stage ? ` at ${g.stage}` : ""})`);
    // One worker: the first request runs, the second waits, the third replaces the second.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await call("POST", `${O}/projects/${a.id}/generations`, { graphs: [graph] });
      must(r.status === 202, `SynCode request ${i + 1} accepted (${r.status})`);
      ids.push((await r.json()).id);
      if (i === 0) await until("first SynCode running", () => get(`${O}/projects/${a.id}/generations/${ids[0]}`), (g) => g.state !== "queued");
    }
    const replaced = await get(`${O}/projects/${a.id}/generations/${ids[1]}`);
    must(replaced.state === "cancelled", `the queued SynCode was replaced by the newest one (${replaced.state})`);
    for (const id of [ids[0], ids[2]]) must((await settled(a.id, id)).success, `SynCode ${id} succeeded`);
    break;
  }
  case "clean": {
    const a = (await app(A))!;
    const before = await get(`${W}/projects/${A}/size`);
    must(before.buildBytes > 0, `${A}: ${(before.bytes / 1e6).toFixed(0)} MB, build outputs ${(before.buildBytes / 1e6).toFixed(0)} MB`);
    console.log(`SIZE_BEFORE=${before.bytes}`);
    const cleaned = await call("POST", `${O}/projects/${a.id}/clean`);
    const { freedBytes } = await cleaned.json();
    const after = await get(`${W}/projects/${A}/size`);
    must(cleaned.status === 200 && freedBytes === before.buildBytes, `Clean freed ${(freedBytes / 1e6).toFixed(0)} MB`);
    must(after.buildBytes === 0 && after.bytes === before.bytes - freedBytes, `${A} after Clean: ${(after.bytes / 1e6).toFixed(1)} MB, sources kept`);
    console.log(`SIZE_AFTER=${after.bytes}`);
    break;
  }
  case "disk": {
    const capacity = await get(`${O}/capacity`);
    must(capacity.disk?.level === "flood", `the workspace reports level flood (${capacity.disk?.level})`);
    const created = await call("POST", `${O}/projects`, { slug: `${slug}-d`, name: "Gate M16 d", language: "cpp", vssRelease: "v4.0" });
    must(created.status === 507 && (await codes(created)).some((c) => c.startsWith("HOST_DISK_LOW")), `no new app on a full disk (${created.status})`);
    const a = (await app(A))!;
    const syncode = await call("POST", `${O}/projects/${a.id}/generations`, { graphs: [graph] });
    must(syncode.status === 507, `SynCode paused on a full disk (${syncode.status})`);
    break;
  }
  case "repair": {
    const b = (await app(B))!;
    must(b.status === "failed", `${B} is failed`);
    const r = await call("POST", `${O}/projects/${b.id}/repair`);
    must(r.status === 202, `repair accepted (${r.status})`);
    must((await ready(B))?.status === "ready", `${B} ready again after repair`);
    break;
  }
  case "sweep": {
    const r = await call("POST", `${O}/sweep`);
    const result = await r.json();
    must(r.status === 200 && result.deleted.includes(B), `the sweeper deleted the old failed app ${B} (${JSON.stringify(result.deleted)})`);
    must(!result.deleted.includes(A) && !(await app(B)), `${A} kept, ${B} gone from the orchestrator`);
    must((await fetch(`${W}/projects/${B}/size`, { headers: h })).status === 404, `${B}'s folder is gone`);
    console.log(`sweep: ${result.deleted.length} deleted, ${result.cleaned.length} cleaned, ${result.cachesRemoved} caches, ${(result.freedBytes / 1e6).toFixed(0)} MB`);
    break;
  }
  case "delete": {
    const a = (await app(A))!;
    must((await call("DELETE", `${O}/projects/${a.id}`)).status === 204, `${A} deleted`);
    must((await fetch(`${W}/projects/${A}/size`, { headers: h })).status === 404, `${A}'s folder is gone`);
    must((await call("DELETE", `${O}/projects/${a.id}`)).status === 404, "deleting again finds nothing");
    break;
  }
  default:
    throw new Error(`unknown STEP ${process.env.STEP}`);
}
