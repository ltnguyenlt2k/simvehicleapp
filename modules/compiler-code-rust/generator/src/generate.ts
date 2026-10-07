import { ContractValidator } from "@simvehicleapp/contracts";
import { OPCODES, UnsupportedOpcode, type WorkflowIr } from "./emit.ts";
import { UnsupportedOp } from "./expr.ts";
import { type FileSet, type GenerateRequest, generateProject } from "./project.ts";

/**
 * `POST /generate` (ADR-0020 §2): validates the request against the contract, checks the IR
 * versions and opcodes this backend supports, then generates. Problems are diagnostics (422), never
 * a partial file set.
 */

export interface Diagnostic {
  code: string;
  severity: "error";
  stage: "backend" | "codegen";
  message: string;
  docs: string;
  workflowId?: string;
  nodeId?: string;
  blockId?: string;
  data?: Record<string, unknown>;
}

export type GenerateResult = { ok: true; fileSet: FileSet } | { ok: false; status: 400 | 422; diagnostics: Diagnostic[]; error?: string };

const validator = new ContractValidator();
const SUPPORTED = new Set<string>(OPCODES);

const diag = (code: string, stage: Diagnostic["stage"], message: string, extra: Partial<Diagnostic> = {}): Diagnostic => ({
  code,
  severity: "error",
  stage,
  message,
  docs: `diagnostics#${code}`,
  ...extra,
});

export function generate(body: unknown): GenerateResult {
  // An IR major version this backend does not read is a 422 with its code, not a schema mismatch.
  const wfs = (body as { workflows?: { irVersion?: unknown; workflowId?: unknown }[] } | null)?.workflows;
  if (Array.isArray(wfs)) {
    const newer = wfs.filter((w) => typeof w?.irVersion === "string" && !/^1\./.test(w.irVersion));
    if (newer.length) {
      return {
        ok: false,
        status: 422,
        diagnostics: newer.map((w) => diag("IR_VERSION_UNSUPPORTED", "backend", `IR ${String(w.irVersion)} is not supported (this backend reads IR 1.x)`, { ...(typeof w.workflowId === "string" ? { workflowId: w.workflowId } : {}), data: { irVersion: w.irVersion } })),
      };
    }
  }
  const v = validator.validate("generated-fileset#/$defs/generateRequest", body);
  if (!v.valid) {
    const errs = v.errors.slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
    return { ok: false, status: 400, diagnostics: [], error: `request does not match GenerateRequest: ${errs.join("; ")}` };
  }
  const req = body as GenerateRequest;
  if (req.project.language !== "rust") {
    return { ok: false, status: 422, diagnostics: [diag("BACKEND_UNAVAILABLE", "backend", `This backend generates Rust, not ${req.project.language}`)] };
  }
  const problems: Diagnostic[] = [];
  for (const wf of req.workflows as WorkflowIr[]) {
    for (const x of [...wf.triggers, ...wf.nodes]) {
      if (!SUPPORTED.has(x.opcode)) {
        problems.push(
          diag("OPCODE_UNSUPPORTED_BY_BACKEND", "backend", `${x.opcode} cannot be generated in Rust yet`, { workflowId: wf.workflowId, nodeId: x.id, blockId: x.src.blockId, data: { opcode: x.opcode, backend: "rust" } }),
        );
      }
    }
  }
  const ids = new Set<string>();
  for (const wf of req.workflows) {
    if (ids.has(wf.workflowId)) problems.push(diag("CODEGEN_INTERNAL_ERROR", "codegen", `Workflow ${wf.workflowId} appears twice`, { workflowId: wf.workflowId }));
    ids.add(wf.workflowId);
  }
  if (problems.length) return { ok: false, status: 422, diagnostics: problems };
  try {
    return { ok: true, fileSet: generateProject(req) };
  } catch (e) {
    if (e instanceof UnsupportedOpcode) {
      return { ok: false, status: 422, diagnostics: [diag("OPCODE_UNSUPPORTED_BY_BACKEND", "backend", e.message, { nodeId: e.nodeId, blockId: e.blockId, data: { opcode: e.opcode, backend: "rust" } })] };
    }
    if (e instanceof UnsupportedOp) {
      return { ok: false, status: 422, diagnostics: [diag("OPCODE_UNSUPPORTED_BY_BACKEND", "backend", e.message, { data: { opcode: e.op, backend: "rust" } })] };
    }
    return { ok: false, status: 422, diagnostics: [diag("CODEGEN_INTERNAL_ERROR", "codegen", `The Rust generator failed: ${(e as Error).message}`)] };
  }
}
