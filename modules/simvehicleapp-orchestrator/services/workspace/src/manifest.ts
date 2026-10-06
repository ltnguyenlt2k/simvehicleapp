/**
 * AppManifest v3 merge (ADR-0023 §4 + Notes): the backend's fragment (all enabled workflows of the
 * project) is merged into `app/AppManifest.json` so that
 *   - datapoints SimVehicleApp manages carry `"x-sv-managed": true`; `access` is `write` when any
 *     workflow writes the signal, else `read`; managed entries no longer needed are removed;
 *   - MQTT topics it manages are tracked in `.simvehicleapp/manifest-managed.json` (strings cannot carry
 *     a marker); entries added by hand are never removed;
 *   - output is sorted and formatted like the template (4 spaces, final newline): merging the same
 *     fragment twice gives the same bytes.
 */

export interface Fragment {
  "vehicle-signal-interface"?: { required?: { path: string; access: "read" | "write" }[]; provided?: unknown[] };
  pubsub?: { reads?: string[]; writes?: string[] };
}

export interface ManagedState {
  datapoints: string[];
  reads: string[];
  writes: string[];
}

type Json = Record<string, unknown>;
interface Datapoint {
  path: string;
  required?: string;
  access?: string;
  "x-sv-managed"?: boolean;
  [k: string]: unknown;
}

const byPath = (a: Datapoint, b: Datapoint) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

export function emptyManaged(): ManagedState {
  return { datapoints: [], reads: [], writes: [] };
}

/** Merges `fragment` into the manifest text; returns the new text and the new managed state. */
export function mergeManifest(text: string | null, appName: string, fragment: Fragment, managedBefore: ManagedState): { text: string; managed: ManagedState } {
  const doc: Json = text ? (JSON.parse(text) as Json) : { manifestVersion: "v3", name: appName, interfaces: [] };
  if (doc.manifestVersion !== "v3") throw new Error(`AppManifest ${String(doc.manifestVersion)} is not supported (v3 only)`);
  doc.name = appName;
  const interfaces = (Array.isArray(doc.interfaces) ? doc.interfaces : []) as Json[];
  doc.interfaces = interfaces;
  const find = (type: string): Json => {
    let i = interfaces.find((x) => x.type === type);
    if (!i) {
      i = { type, config: {} };
      interfaces.push(i);
    }
    if (!i.config || typeof i.config !== "object") i.config = {};
    return i.config as Json;
  };

  // datapoints
  const wanted = new Map((fragment["vehicle-signal-interface"]?.required ?? []).map((d) => [d.path, d.access]));
  const vsi = find("vehicle-signal-interface");
  const dps = (vsi.datapoints && typeof vsi.datapoints === "object" ? vsi.datapoints : (vsi.datapoints = {})) as Json;
  const current = (Array.isArray(dps.required) ? dps.required : []) as Datapoint[];
  const wasManaged = new Set(managedBefore.datapoints);
  const out: Datapoint[] = [];
  for (const d of current) {
    const managed = d["x-sv-managed"] === true || wasManaged.has(d.path);
    if (!managed) out.push(d); // by hand: kept as is, even when a workflow uses the same path
  }
  const handPaths = new Set(out.map((d) => d.path));
  const managedNow: string[] = [];
  for (const [path, access] of wanted) {
    if (handPaths.has(path)) {
      // An entry written by hand stays, but a workflow that writes the signal needs write access.
      const d = out.find((x) => x.path === path)!;
      if (access === "write" && d.access !== "write") d.access = "write";
      continue;
    }
    out.push({ path, required: "true", access, "x-sv-managed": true });
    managedNow.push(path);
  }
  dps.required = out.sort(byPath);

  // pubsub topics
  const ps = find("pubsub");
  const merge = (key: "reads" | "writes") => {
    const have = Array.isArray(ps[key]) ? (ps[key] as string[]) : [];
    const before = new Set(managedBefore[key]);
    const hand = have.filter((t) => !before.has(t));
    const want = fragment.pubsub?.[key] ?? [];
    const managed = want.filter((t) => !hand.includes(t));
    ps[key] = sorted([...hand, ...managed]);
    return sorted(managed);
  };
  const reads = merge("reads");
  const writes = merge("writes");

  return { text: `${JSON.stringify(doc, null, 4)}\n`, managed: { datapoints: sorted(managedNow), reads, writes } };
}

/** At project creation: the template's sample-app entries go with the sample app (ADR-0023 Notes M7). */
export function resetSampleEntries(text: string, appName: string): string {
  const doc = JSON.parse(text) as Json;
  doc.name = appName;
  for (const i of (doc.interfaces ?? []) as Json[]) {
    const c = (i.config ?? {}) as Json;
    if (i.type === "vehicle-signal-interface" && c.datapoints && typeof c.datapoints === "object") (c.datapoints as Json).required = [];
    if (i.type === "pubsub") {
      c.reads = [];
      c.writes = [];
    }
  }
  return `${JSON.stringify(doc, null, 4)}\n`;
}
