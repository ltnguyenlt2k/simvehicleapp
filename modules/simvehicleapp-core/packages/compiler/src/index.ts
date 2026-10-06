export { diag, sortDiagnostics, type DiagnosticInput } from "./diagnostics.ts";
export { MIGRATIONS, migrateGraph, type Migration, type MigrationFailure, type MigrationRegistry } from "./migrations.ts";
export { lint, MAX_BLOCKS, MAX_GRAPH_BYTES, normalizeName, type LintContext, type ModelHashLookup, type VehicleLookup } from "./lint.ts";
export { BackendUnavailableError, type CapabilitiesLookup, checkBackend, httpCapabilities, type IrForCapabilities } from "./capabilities.ts";
export { analyzeControlFlow, type ControlFlow } from "./controlflow.ts";
export { type IrExpr, type RefBinding, type Typed, Typer, type TyperCode, type TyperDiagnostic, type TypeEnv } from "./typer.ts";
