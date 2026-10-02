# Module: `simvehicleapp-orchestrator`

**Tầng:** L2 · **ADR:** 0020, 0023, 0024, 0026, 0027, 0031, 0033 · **Milestone:** M7–M9
**Containers:** `orchestrator` :4030, `workspace` :4040, `signal-gateway` :4050

## Services
| Service | Trách nhiệm chính |
|---|---|
| orchestrator | Project CRUD (schema `sv`), GenerationPipeline (SynCode stages: ir → codegen → write → deps? → build → format-check → test), RunManager, TraceIngest, EventHub SSE, BackendRegistry, ToolchainClient, EntitlementService, source-map error mapping |
| workspace | init project, commit atomic, AppManifest merge, rollback, export zip, tree/read API (read-only cho UI xem file) |
| signal-gateway | kết nối databroker (kuksa.val.v1 gRPC), WS subscribe/set, snapshot, scenario player |

## Cấu trúc
```
services/orchestrator/src/{api,pipeline,runs,trace,backends,toolchains,entitlement,db(drizzle, schema sv)}
services/workspace/src/{paths,staging,commit,journal,manifest-merge,export,templates}
services/signal-gateway/src/{kuksa-v1-client,ws,scenario}
proto/ (kuksa.val.v1 từ kuksa-databroker, Apache-2.0, pin tag 0.5.0)
```
## Job queue
Bảng `sv.job` (Postgres `SELECT … FOR UPDATE SKIP LOCKED`), 1 worker/ngôn ngữ cho build; retry chỉ cho lỗi hạ tầng (không cho lỗi compile).

## Test
Pipeline với backend/toolchain giả (contract fixtures); workspace fault-injection & path security; gateway với databroker thật (integration, compose test).
