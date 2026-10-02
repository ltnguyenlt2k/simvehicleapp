# Module: `simvehicleapp-contracts`

**Tầng:** shared · **ADR:** 0007, 0014, 0016, 0020 · **Milestone:** M0 (draft), khoá dần M2–M10

## Trách nhiệm
Nguồn sự thật cho mọi schema/API giữa module + fixture dùng chung (golden, conformance). Sinh package: npm `@simvehicleapp/contracts`, pypi `simvehicleapp-contracts`, crate `simvehicleapp-contracts` (M13).

## Cấu trúc
```
schemas/
  workflow-graph.v1.schema.json   ir.v1.schema.json           diagnostics.v1.schema.json
  diagnostics-catalog.v1.json     block-spec.v1.schema.json   generated-fileset.v1.schema.json
  backend-capabilities.v1.schema.json   toolchain-job.v1.schema.json
  trace-event.v1.schema.json      log-line.v1.schema.json     signal-update.v1.schema.json
  scenario.v1.schema.json         workflow-patch.v1.schema.json  generation-manifest.v1.schema.json
  license.v1.schema.json
openapi/
  vss-catalog.v1.yaml  compiler.v1.yaml  orchestrator.v1.yaml  workspace.v1.yaml
  backend-plugin.v1.yaml  toolchain.v1.yaml  ai-assistant.v1.yaml
asyncapi/ signal-gateway.v1.yaml  events-sse.v1.yaml
fixtures/
  vss/ (vss_rel_4.0.json + units.yaml seed)   golden/GW-A..G/   conformance/*.yaml
packages/
  ts/ (types sinh bằng json-schema-to-typescript + ajv validators + service-kit: healthz/version/log/internal-auth)
  py/  (datamodel-codegen)
tools/ gen.ts · check-breaking.ts (so với tag trước → yêu cầu major + ADR)
```

## Quy tắc
- Semver cho từng schema (trong `$id`) và cho package tổng.
- Breaking ⇒ major + ADR; CI `check-breaking`.
- Không chứa logic nghiệp vụ (ngoại lệ: `service-kit` hạ tầng nhỏ).
