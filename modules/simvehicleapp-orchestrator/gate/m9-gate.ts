/**
 * M9 acceptance gate steps (analysis/phases/M09 "Gate"), run by `m9-gate.sh` on the dev stack's
 * sv-internal network. STEP=prepare: project + SynCode GW-A (prints SLUG/ID/EDITOR); STEP=export:
 * project zip checked entry by entry and written to /out/<slug>.zip; STEP=license: prints a restricted
 * test license + its public key (base64) for the PDP check; STEP=pdp: the enforced license denies
 * export and a language outside it, allows SynCode of C++.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const O = "http://orchestrator:4030";
const slug = process.env.SLUG ?? "";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const golden = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A";
const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const project = async () => (await get(`${O}/projects`)).projects.find((p: { slug: string }) => p.slug === slug);

function entries(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const body = bytes.subarray(local + 30 + v.getUint16(local + 26, true), local + 30 + v.getUint16(local + 26, true) + size);
    out.set(name, method === 8 ? inflateRawSync(body).toString("utf8") : new TextDecoder().decode(body));
    at += 46 + nameLen;
  }
  return out;
}

switch (process.env.STEP) {
  case "prepare": {
    let p = await (await fetch(`${O}/projects`, { method: "POST", headers: h, body: JSON.stringify({ slug, name: "Gate M9", language: "cpp", vssRelease: "v4.0" }) })).json();
    while (p.status === "creating") {
      await Bun.sleep(2000);
      p = await get(`${O}/projects/${p.id}`);
    }
    must(p.status === "ready", `project ${slug} ready`);
    const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
    const scenario = Bun.YAML.parse(readFileSync(`${golden}/scenario.yaml`, "utf8"));
    const g = await (await fetch(`${O}/projects/${p.id}/generations`, { method: "POST", headers: h, body: JSON.stringify({ graphs: [graph], scenarios: [{ workflowId: graph.workflowId, scenario }] }) })).json();
    await (await fetch(`${O}/events?generationId=${g.id}`, { headers: h })).text();
    const done = await get(`${O}/projects/${p.id}/generations/${g.id}`);
    must(done.success, `SynCode GW-A ${done.id}`);
    p = await get(`${O}/projects/${p.id}`);
    must(p.editor?.url?.endsWith(`?folder=/workspace/projects/${slug}`), `Project.editor.url ${p.editor?.url}`);
    console.log(`EDITOR=${p.editor.url}`);
    break;
  }
  case "export": {
    const p = await project();
    const res = await fetch(`${O}/projects/${p.id}/export`, { method: "POST", headers: h });
    must(res.status === 200 && res.headers.get("content-type") === "application/zip", `export ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const files = entries(bytes);
    for (const f of [".simvehicleapp/workflows/gw_a.graph.json", ".simvehicleapp/generation.json", ".simvehicleapp/project.json", "README.SIMVEHICLE.md", "NOTICE", "THIRD-PARTY-NOTICES", "app/Dockerfile", "app/AppManifest.json", "app/src/generated/workflows/StableOverspeedWarning.cpp", "app/src/simvehicleapp-runtime/src/Runtime.cpp", "conanfile.txt", ".velocitas.json"]) must(files.has(f), `zip has ${f}`);
    must(![...files.keys()].some((f) => /^(build|\.git)\//.test(f)), "no build outputs, no VCS");
    const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
    // Same content (Postgres jsonb keeps its own key order).
    must(Bun.deepEquals(JSON.parse(files.get(".simvehicleapp/workflows/gw_a.graph.json")!), graph), "the exported graph is the GW-A WorkflowGraph (re-importable)");
    const again = new Uint8Array(await (await fetch(`${O}/projects/${p.id}/export`, { method: "POST", headers: h })).arrayBuffer());
    must(Buffer.compare(Buffer.from(bytes), Buffer.from(again)) === 0, `same project ⇒ same zip bytes (${bytes.length} B, ${files.size} files)`);
    writeFileSync(`/out/${slug}.zip`, bytes);
    break;
  }
  case "license": {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const canonical = (v: unknown): string =>
      Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
    const doc = { licenseVersion: "1.0.0", edition: "gate-restricted", licensee: "M9 gate", features: { "export.source": false, languages: ["cpp"] }, limits: {}, expiry: null };
    const license = { ...doc, signature: sign(null, Buffer.from(canonical(doc)), privateKey).toString("base64") };
    console.log(`SV_LICENSE_KEY=${Buffer.from(JSON.stringify(license)).toString("base64")}`);
    console.log(`SV_LICENSE_PUBLIC_KEY=${Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64")}`);
    break;
  }
  case "pdp": {
    const status = await get(`${O}/entitlements`);
    must(status.mode === "enforce" && status.licensed && status.edition === "gate-restricted", `entitlements ${JSON.stringify(status)}`);
    const p = await project();
    const exp = await fetch(`${O}/projects/${p.id}/export`, { method: "POST", headers: h });
    must(exp.status === 403 && (await exp.json()).feature === "export.source", "export denied by the license (403 not_entitled)");
    const py = await fetch(`${O}/projects`, { method: "POST", headers: h, body: JSON.stringify({ slug: `${slug}-py`, name: "Py", language: "python", vssRelease: "v4.0" }) });
    must(py.status === 403, "a Python project is denied (languages: cpp)");
    const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
    const g = await fetch(`${O}/projects/${p.id}/generations`, { method: "POST", headers: h, body: JSON.stringify({ graphs: [graph] }) });
    must(g.status === 202, "SynCode of the C++ project is allowed");
    await (await fetch(`${O}/events?generationId=${(await g.json()).id}`, { headers: h })).text();
    break;
  }
  default:
    must(false, `unknown STEP ${process.env.STEP}`);
}
