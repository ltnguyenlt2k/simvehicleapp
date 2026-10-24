/**
 * M18-T10 gate (ADR-0060), run by `m18-image.sh` on sv-internal: SynCode GW-A, then POST /projects/{id}/images to the
 * gate's registry; prints `DIGEST <sha256:…>` for the shell to pull and run.
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const slug = `${process.env.SLUG}-${process.env.LANG_ID}`;
const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.log(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(900_000) });

const graph = JSON.parse(readFileSync("/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A/graph.json", "utf8"));
let p = await (await post(`${O}/projects`, { slug, name: "Gate image", language: process.env.LANG_ID ?? "cpp", vssRelease: "v4.0" })).json();
const t0 = Date.now();
while (p.status === "creating" && Date.now() - t0 < 600_000) {
  await Bun.sleep(2000);
  p = await get(`${O}/projects/${p.id}`);
}
must(p.status === "ready", `app ${slug} ready`);
const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph] })).json();
await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
must((await get(`${O}/projects/${p.id}/generations/${queued.id}`)).success, "SynCode GW-A");
const reference = `${process.env.REG}:5000/gate/${process.env.SLUG}:1`;
const started = Date.now();
const res = await post(`${O}/projects/${p.id}/images`, { reference, insecure: true });
const body = await res.json();
must(res.status === 200 && /^sha256:[0-9a-f]{64}$/.test(body.digest), `image pushed in ${Math.round((Date.now() - started) / 1000)} s: ${body.digest} (${body.bytes} bytes, ${body.files} files) ${res.status !== 200 ? JSON.stringify(body) : ""}`);
console.log(`DIGEST ${body.digest}`);
