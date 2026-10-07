/**
 * M13-T04: stages one Velocitas project that holds every golden workflow (GW-A…GW-G) as a single
 * app — the overlay, the vendored runtime and the generated files exactly as the backend serves
 * them — for a real check in a Python environment or the toolchain image.
 *
 *   bun conformance/stage-project.ts <out-dir>
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixturesDir } from "@simvehicleapp/contracts";
import { overlayBundle, runtimeBundle } from "../src/bundle.ts";
import { generate } from "../src/generate.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: stage-project.ts <out-dir>");
const ids = readdirSync(join(fixturesDir, "golden")).filter((d) => d.startsWith("GW-")).sort();
const workflows = ids.map((id) => JSON.parse(readFileSync(join(fixturesDir, "golden", id, "ir.json"), "utf8")));
const scenarios = ids.map((id, i) => ({ workflowId: workflows[i].workflowId, scenario: Bun.YAML.parse(readFileSync(join(fixturesDir, "golden", id, "scenario.yaml"), "utf8")) }));
const r = generate({ project: { slug: "goldens", appName: "GoldensApp", language: "rust", mqttTopicPrefix: "simvehicleapp/goldens", traceLevel: "node" }, workflows, options: { emitTests: true }, scenarios });
if (!r.ok) throw new Error(JSON.stringify(r));
const write = (path: string, content: string) => {
  mkdirSync(dirname(join(out, "files", path)), { recursive: true });
  writeFileSync(join(out, "files", path), content);
};
const overlay = overlayBundle();
for (const f of [...overlay.files, ...runtimeBundle().files, ...r.fileSet.files]) write(f.path, f.content);
writeFileSync(join(out, "remove.txt"), `${(overlay.remove ?? []).join("\n")}\n`);
writeFileSync(join(out, "manifest-fragment.json"), JSON.stringify(r.fileSet.manifestFragment, null, 2));
console.log(`staged ${workflows.length} workflows, ${r.fileSet.files.length} generated files in ${out}`);
