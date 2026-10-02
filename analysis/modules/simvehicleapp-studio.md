# Module: `simvehicleapp-studio` (fork Sim v0.7.13)

**Tầng:** L1 · **ADR:** 0003, 0004, 0008, 0011, 0013, 0027, 0030 · **Milestone:** M1, M2, M3, M5, M7–M10
**Containers:** `studio` :3000, `realtime` :3002, `migrations`

## Trách nhiệm
UI (canvas, toolbar Vehicle, property panel, bottom dock, assistant panel), auth, lưu workflow (DB Sim), **BFF** `/api/sv/*` (auth + proxy tới service nội bộ, SSE/WS passthrough), adapter `toWorkflowGraph`.

## Không làm
Compile, codegen, ghi workspace, gọi LLM trực tiếp, gọi toolchain.

## Thêm mới (vị trí đề xuất)
```
apps/sim/blocks/vehicle/          # BlockConfig sv_* (UI)
apps/sim/lib/sv/                  # graph-adapter.ts, api-client.ts, brand.ts, stubs/
apps/sim/app/api/sv/**            # BFF routes
apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/sv/   # VehicleTree, SynCodeBar, BottomDock(Problems, Simulation, RunConsole, Signals, BuildLog), AssistantPanel, PatchPreview, TraceOverlay
packages/workflow-types/src/blocks.ts   # + SubBlockType: vss-path-selector, sv-expression, sv-duration, sv-enum, sv-typed-value
docker/app.Dockerfile, realtime.Dockerfile, migrations.Dockerfile
```

## Contract tiêu thụ
catalog v1, compiler v1, orchestrator v1, signal-gateway v1, ai-assistant v1, block-spec v1.

## Test
Vitest (đã có trong Sim) cho adapter/components; `graph-adapter.golden.test.ts` (sim-state.json → graph.json); `block-parity.test.ts` (BlockConfig ↔ BlockSpec); Playwright component cho toolbar/diagnostics.
