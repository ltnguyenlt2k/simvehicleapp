/**
 * Toolchain output ⇒ diagnostics on blocks (M07-T15, ADR-0022 §6): compiler errors in generated
 * files are mapped through the generation's source maps to the block that produced the line; failing
 * generated tests name their workflow; dependency failures keep the tool's own error lines.
 */

export interface SourceMap {
  file: string;
  ranges: { startLine: number; endLine: number; nodeId: string; blockId: string; workflowId: string }[];
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  stage: string;
  message: string;
  docs: string;
  blockId?: string;
  nodeId?: string;
  workflowId?: string;
  data?: Record<string, unknown>;
}

const diag = (code: string, stage: string, message: string, extra: Partial<Diagnostic> = {}): Diagnostic => ({
  code,
  severity: "error",
  stage,
  message,
  docs: `diagnostics#${code}`,
  ...extra,
});

/** `path:line:col: error: message` of GCC and Clang (also `fatal error`). */
const COMPILER_ERROR = /^(?<file>[^\s:][^:]*):(?<line>\d+):(?:(?<col>\d+):)?\s*(?:fatal )?error:\s*(?<msg>.*)$/;
/** Generated files are named relative to the project root, whatever absolute path the build saw. */
const PROJECT_REL = /(app\/(?:src|tests)\/generated\/.*)$/;

export function compileDiagnostics(lines: readonly string[], maps: readonly SourceMap[], max = 20): Diagnostic[] {
  const byFile = new Map(maps.map((m) => [m.file, m]));
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const m = COMPILER_ERROR.exec(raw.trim());
    if (!m?.groups) continue;
    const { file, line, col, msg } = m.groups as { file: string; line: string; col?: string; msg: string };
    const rel = PROJECT_REL.exec(file)?.[1] ?? file;
    const n = Number(line);
    const key = `${rel}:${n}:${msg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const map = byFile.get(rel);
    // the innermost range holding the line (ranges never overlap except the whole-file host)
    const hit = map?.ranges.filter((r) => r.startLine <= n && n <= r.endLine).sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
    const where = `${rel}:${n}${col ? `:${col}` : ""}`;
    out.push(
      diag("CPP_COMPILE_ERROR", "build", hit ? `C++ error in the code of this block: ${msg}` : `C++ error at ${where}: ${msg}`, {
        ...(hit ? { blockId: hit.blockId, nodeId: hit.nodeId, workflowId: hit.workflowId } : {}),
        data: { file: rel, line: n, ...(col ? { column: Number(col) } : {}), compiler: msg },
      }),
    );
    if (out.length >= max) break;
  }
  return out;
}

/** gtest: `[  FAILED  ] <Class>Test.<case>` + the failure text before it ⇒ one diagnostic per test. */
export function testDiagnostics(lines: readonly string[], workflowOfClass: (cls: string) => string | undefined): Diagnostic[] {
  const out: Diagnostic[] = [];
  let current: { name: string; text: string[] } | null = null;
  for (const raw of lines) {
    const l = raw.trimEnd();
    const run = /^\[ RUN {6}\] (\S+)/.exec(l);
    if (run) {
      current = { name: run[1]!, text: [] };
      continue;
    }
    const failed = /^\[ {2}FAILED {2}\] (\S+?)(?: \(\d+ ms\))?$/.exec(l);
    if (failed && current && failed[1] === current.name) {
      const cls = current.name.split(".")[0]!.replace(/Test$/, "");
      const workflowId = workflowOfClass(cls);
      const detail = current.text.filter((t) => !/^\s*$/.test(t) && !/: Failure$/.test(t) && t !== "Failed").join("\n").slice(0, 2000);
      out.push(diag("GENERATED_TEST_FAILED", "test", `The scenario test of this workflow failed${detail ? `: ${detail.split("\n")[0]}` : ""}`, { ...(workflowId ? { workflowId } : {}), data: { test: current.name, detail } }));
      current = null;
      continue;
    }
    if (current) current.text.push(l);
  }
  return out;
}

/** Conan/CMake errors of `install_dependencies.sh` (first few `ERROR:` lines). */
export function depsDiagnostics(lines: readonly string[]): Diagnostic[] {
  const errors = lines.filter((l) => /^ERROR:|CMake Error|error:/i.test(l.trim())).slice(0, 5);
  return [diag("DEPS_INSTALL_FAILED", "build", errors[0]?.trim() ?? "Installing the project dependencies failed", { data: { lines: errors } })];
}
