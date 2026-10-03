import { fileURLToPath } from "node:url";

export const CONTRACTS_VERSION = "1.0.0-alpha.1";

/** Schema file stems under `schemas/` (`<name>.v1.schema.json`). */
export const SCHEMA_NAMES = [
  "common",
  "diagnostics",
  "diagnostics-catalog",
  "workflow-graph",
  "ir",
  "block-spec",
  "generated-fileset",
  "backend-capabilities",
  "toolchain-job",
  "trace-event",
  "log-line",
  "signal-update",
  "scenario",
  "workflow-patch",
  "generation-manifest",
  "license",
  "service-info",
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export const schemasDir = fileURLToPath(new URL("../../../schemas/", import.meta.url));
export const openapiDir = fileURLToPath(new URL("../../../openapi/", import.meta.url));
export const fixturesDir = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export function schemaId(name: SchemaName): string {
  return `urn:simvehicleapp:contracts:${name}:${CONTRACTS_VERSION}`;
}
