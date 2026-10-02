# ADR-0016: Catalog diagnostics với mã ổn định

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-WF-04; Master Plan 7.2, 13.4; [06 §6](../06-ir-and-compiler.md#6-diagnostics-format-không-đổi-so-với-master-plan-bổ-sung-trường)

## Decision
1. Format: `{code, severity, stage, blockId?, field?, nodeId?, message, suggestion?, docs, data?}`; `message` i18n theo `code` + `data` (không ghép chuỗi tự do ở backend).
2. Mã là **API công khai**: không đổi tên/xoá; deprecate bằng cờ. Catalog `diagnostics.v1.json` trong contracts sinh `docs/DIAGNOSTICS_CATALOG.md`.
3. Catalog P0/P1 (tối thiểu):

| Code | Sev | Stage |
|---|---|---|
| GRAPH_SCHEMA_INVALID, GRAPH_TOO_LARGE | error | parse |
| GRAPH_DANGLING_EDGE, BLOCK_TYPE_UNKNOWN, HANDLE_UNKNOWN, CONTAINER_INVALID | error | structural |
| BLOCK_PROPERTY_MISSING, BLOCK_PROPERTY_INVALID, EXPR_SYNTAX, EXPR_UNKNOWN_REF, EXPR_UNKNOWN_FUNCTION, BLOCK_VERSION_UNSUPPORTED | error | block-config |
| VEHICLE_PATH_NOT_FOUND, VEHICLE_WRITE_READ_ONLY, VEHICLE_PATH_IS_BRANCH, ENUM_VALUE_NOT_ALLOWED | error | vehicle-model |
| VALUE_OUT_OF_RANGE, MODEL_HASH_MISMATCH, VEHICLE_PATH_DEPRECATED | warning | vehicle-model |
| TYPE_MISMATCH, TYPE_NARROWING_REQUIRES_CAST | error | types |
| UNIT_DIMENSION_MISMATCH | error | units |
| UNIT_CONVERSION_INSERTED, UNIT_ASSUMED | info | units |
| CONTROL_FLOW_CYCLE, DATA_REF_NOT_DOMINATING, LOOP_GUARD_MISSING, PARALLEL_BRANCH_EMPTY | error | control-flow |
| TRIGGER_WITHOUT_ACTION, BLOCK_UNREACHABLE | warning | control-flow |
| POLLING_PREFER_SUBSCRIPTION | info | lint |
| OPCODE_UNSUPPORTED_BY_BACKEND, IR_VERSION_UNSUPPORTED, BACKEND_UNAVAILABLE | error | backend |
| CODEGEN_INTERNAL_ERROR | error | codegen |
| WORKSPACE_PATH_REJECTED, GENERATED_FILE_MODIFIED, WORKSPACE_COMMIT_FAILED | error/warning | workspace |
| DEPS_INSTALL_FAILED, CPP_COMPILE_ERROR, BUILD_FAILED, GENERATED_TEST_FAILED | error | build/test |
| RUN_START_TIMEOUT, RUN_CRASHED, VDB_UNREACHABLE | error | run |
| LICENSE_FEATURE_DENIED | error | license |
| ARRAY_VALUE_REQUIRES_INDEXING, ARRAY_INDEX_TYPE_INVALID, ARRAY_ELEMENT_TYPE_MISMATCH | error | types (xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md)) |
| ARRAY_INDEX_OUT_OF_RANGE | warning | runtime (trace, không chặn build — ADR-0018 §4) |

4. Không bao giờ trả stack trace thô cho UI; log chi tiết giữ ở orchestrator, UI có link "xem log".

## Verification
Test "cố ý sai" cho mỗi mã error P0 (Master Plan Phase 12); snapshot catalog; CI chặn xoá mã.
