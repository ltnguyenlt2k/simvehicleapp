import { createPublicKey, type KeyObject, verify } from "node:crypto";
import { ContractValidator } from "@simvehicleapp/contracts";

/**
 * EntitlementService (ADR-0031 §2–4, M09-T07): the only decision point for licensed features. A
 * license is License v1 JSON (`SV_LICENSE_KEY`) signed with Ed25519 over its canonical JSON (sorted
 * keys, without `signature`), verified offline with the public key shipped with the orchestrator.
 *
 * `SV_LICENSE_MODE=full` (MVP default) allows everything but still evaluates and logs what the
 * license would decide; `enforce` applies it (no valid license ⇒ every gated feature is denied).
 */

export type Feature = "syncode" | "export.source" | "export.runtimeSource" | "ide.access" | "ai.assistant" | "project.create";

export interface License {
  licenseVersion: string;
  edition: string;
  licensee: string;
  features: { "export.source"?: boolean; "export.runtimeSource"?: boolean; "ai.assistant"?: boolean; "ide.access"?: boolean; syncode?: boolean; languages?: string[] };
  limits: { maxProjects?: number };
  expiry: string | null;
  signature: string;
}

export interface Decision {
  feature: Feature;
  allowed: boolean;
  /** What the license says, whatever the mode. */
  licensed: boolean;
  mode: "full" | "enforce";
  reason: string;
}

export interface CheckContext {
  language?: string;
  projectCount?: number;
}

const validator = new ContractValidator();

/** Canonical JSON: object keys sorted at every level (what the signature covers). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export type LoadedLicense = { ok: true; license: License } | { ok: false; reason: string };

/** Parses and verifies a license (schema, Ed25519 signature) — offline. */
export function loadLicense(text: string | undefined, publicKeyPem: string | undefined): LoadedLicense {
  if (!text?.trim()) return { ok: false, reason: "no license (SV_LICENSE_KEY is empty)" };
  let doc: unknown;
  try {
    const raw = text.trim();
    doc = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "the license is not JSON (or base64 JSON)" };
  }
  const v = validator.validate("license", doc);
  if (!v.valid) return { ok: false, reason: `the license does not match License v1: ${v.errors[0]?.instancePath ?? ""} ${v.errors[0]?.message ?? ""}`.trim() };
  if (!publicKeyPem?.trim()) return { ok: false, reason: "no license public key to verify the signature" };
  let key: KeyObject;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, reason: "the license public key is not a PEM public key" };
  }
  const { signature, ...unsigned } = doc as License;
  const good = verify(null, Buffer.from(canonicalJson(unsigned)), key, Buffer.from(signature, "base64"));
  return good ? { ok: true, license: doc as License } : { ok: false, reason: "the license signature is invalid" };
}

export class EntitlementService {
  constructor(
    private readonly mode: "full" | "enforce",
    private readonly loaded: LoadedLicense,
    private readonly log: (decision: Decision & CheckContext) => void = () => {},
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  /** The signed license document (shipped as `.simvehicleapp/license.json` in exports), if valid. */
  get document(): License | null {
    return this.loaded.ok ? this.loaded.license : null;
  }

  /** Summary for clients (what to show, not a decision). */
  get status() {
    return this.loaded.ok
      ? { mode: this.mode, licensed: true, edition: this.loaded.license.edition, licensee: this.loaded.license.licensee, expiry: this.loaded.license.expiry, features: this.loaded.license.features, limits: this.loaded.license.limits }
      : { mode: this.mode, licensed: false, reason: this.loaded.reason };
  }

  /** Whether a feature is usable, without logging (what the UI shows, e.g. the IDE link). */
  allows(feature: Feature, ctx: CheckContext = {}): boolean {
    return this.mode === "full" || this.licensed(feature, ctx).ok;
  }

  check(feature: Feature, ctx: CheckContext = {}): Decision {
    const verdict = this.licensed(feature, ctx);
    const decision: Decision = { feature, licensed: verdict.ok, allowed: this.mode === "full" || verdict.ok, mode: this.mode, reason: verdict.reason };
    this.log({ ...decision, ...ctx });
    return decision;
  }

  private licensed(feature: Feature, ctx: CheckContext): { ok: boolean; reason: string } {
    if (!this.loaded.ok) return { ok: false, reason: this.loaded.reason };
    const l = this.loaded.license;
    if (l.expiry !== null && this.today() > l.expiry) return { ok: false, reason: `the license expired on ${l.expiry}` };
    if (ctx.language && l.features.languages && !l.features.languages.includes(ctx.language)) {
      return { ok: false, reason: `the license does not include ${ctx.language} (${l.features.languages.join(", ") || "no language"})` };
    }
    if (feature === "project.create") {
      const max = l.limits.maxProjects;
      if (max !== undefined && (ctx.projectCount ?? 0) >= max) return { ok: false, reason: `the license allows ${max} project(s)` };
      return { ok: true, reason: `${l.edition} license` };
    }
    // A feature the license does not mention is allowed (features restrict, they do not grant).
    if (l.features[feature] === false) return { ok: false, reason: `${feature} is not part of the ${l.edition} license` };
    return { ok: true, reason: `${l.edition} license` };
  }
}
