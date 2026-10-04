import type { DiagnosticV1, DiagnosticsCatalogV1 } from "@simvehicleapp/contracts";
import catalogJson from "@simvehicleapp/contracts/schemas/diagnostics-catalog.v1.json" with { type: "json" };

const catalog = catalogJson as DiagnosticsCatalogV1;
const BY_CODE = new Map(catalog.codes.map((c) => [c.code, c]));

export interface DiagnosticInput {
  blockId?: string;
  field?: string;
  message: string;
  suggestion?: string;
  data?: Record<string, unknown>;
}

/**
 * Builds a diagnostic whose severity and stage come from the public catalog (ADR-0016), so the
 * compiler can never disagree with it. Unknown codes are a programming error.
 */
export function diag(code: string, workflowId: string, input: DiagnosticInput): DiagnosticV1 {
  const entry = BY_CODE.get(code);
  if (!entry) throw new Error(`diagnostic ${code} is not in the catalog`);
  return {
    code,
    severity: entry.severity as DiagnosticV1["severity"],
    stage: entry.stage as DiagnosticV1["stage"],
    workflowId,
    ...(input.blockId ? { blockId: input.blockId } : {}),
    ...(input.field ? { field: input.field } : {}),
    message: input.message,
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
    docs: `diagnostics#${code}`,
    ...(input.data ? { data: input.data } : {}),
  };
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Deterministic order: graph block order, then severity, code, field. */
export function sortDiagnostics(list: DiagnosticV1[], blockOrder: readonly string[]): DiagnosticV1[] {
  const pos = new Map(blockOrder.map((id, i) => [id, i]));
  return [...list].sort(
    (a, b) =>
      (pos.get(a.blockId ?? "") ?? -1) - (pos.get(b.blockId ?? "") ?? -1) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.code.localeCompare(b.code) ||
      (a.field ?? "").localeCompare(b.field ?? ""),
  );
}
