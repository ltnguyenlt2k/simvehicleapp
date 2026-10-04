# Changelog

## Unreleased
- `openapi/compiler.v1.yaml` (additive): `/lint` documents 400/413/503 (M03-T11).
- Generated `DIAGNOSTICS_CATALOG.md` + guard against removing/renaming codes (ADR-0016).
- Fixtures: 38 conformance cases `fixtures/conformance/C01…C38/{graph.json, scenario.yaml}` (ADR-0012 executable spec, M03-T12) + consistency test; GW-A updated to BlockSpec handle ids (`source`/`target`) and normalized references (`<speedchanged.value>`).
- `openapi/vss-catalog.v1.yaml` (additive): 304/400/404/503 responses, optional `unknown[]` on `/nodes`, strong-ETag and `/tree` root semantics documented (M02-T04, ADR-0010 Notes).
- Build-only image `simvehicleapp/contracts:dev` (`Dockerfile`, `compose.yaml`, profile `build`) so other modules consume contracts without a build context outside their folder (ADR-0009).
- Fixtures: VSS v4.2 JSON + `v4.2/units.yaml` + `v4.2/quantities.yaml` (M02-T01/T02, ADR-0010; unmodified, provenance updated).

## 1.0.0-alpha.1 — unreleased (M00-T05/T06)
- JSON Schemas: common, workflow-graph, ir, diagnostics, diagnostics-catalog (+ 50-code catalog from ADR-0016/0018), block-spec,
  generated-fileset, backend-capabilities, toolchain-job, trace-event, log-line, signal-update, scenario, workflow-patch,
  generation-manifest, license, service-info.
- OpenAPI 3.1 skeletons for 8 services + test against the vendored OAS 3.1 meta-schema.
- `@simvehicleapp/service-kit` 1.0.0-alpha.1: healthz/version, internal auth (fail closed), request ids, JSON line logger.
- TS package: Ajv 2020 validator (`ContractValidator`) + generated types (`tools/gen-types.ts`).
- Packaging: LICENSE/NOTICE, tests excluded from tarballs, `bun link` verified from a consumer.
- Fixtures: VSS v4.0 JSON + units.yaml seed (provenance in `fixtures/vss/PROVENANCE.md`), golden GW-A `graph.json` + `scenario.yaml`.
