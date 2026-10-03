---
name: sim-fork-refactor
description: Modify the pinned Sim studio fork, vehicle canvas integration, graph adapter, BFF, rebranding or EE and Copilot removal.
---

# Refactor fork Sim (`simvehicleapp-studio`)

Tham chiếu: `analysis/11-sim-refactor-plan.md`, ADR-0003/0004/0008/0011, `analysis/modules/simvehicleapp-studio.md`.

## Bản đồ Sim v0.7.13 (đã verify)
- Stack: Next.js App Router + Bun, Drizzle/Postgres (`packages/db`), Better Auth, Socket.io (`apps/realtime`), ReactFlow, Zustand, Vitest, Biome, Turborepo.
- Blocks: `apps/sim/blocks/{registry.ts,index.ts,types.ts,utils.ts,blocks/*.ts}` — `BlockConfig { type, name, description, category, bgColor, icon, subBlocks, tools, inputs, outputs, hideFromToolbar?, triggers? }`.
- Types workflow: `packages/workflow-types/src/{workflow.ts,blocks.ts}` — `BlockState`, `SubBlockState`, `SubBlockType`, subflow `loop|parallel` (`data.parentId`).
- Store: `apps/sim/stores/workflows/{workflow,subblock,registry}`; serializer `apps/sim/serializer`; executor `apps/sim/executor` (**không dùng** cho vehicle).
- Edge = control flow; data = `<blockName.field>` trong subBlock value.
- Copilot: `apps/sim/lib/copilot/**`, `app/api/copilot/**` (gọi `copilot.sim.ai`) → gỡ.
- Enterprise: `apps/sim/ee/**` → gỡ (license).
- Providers LLM: `apps/sim/providers/**` → dành cho `simvehicleapp-ai`.
- Env: `apps/sim/lib/core/config/env.ts` (zod).

## Luật sửa
- Code mới đặt ở `apps/sim/blocks/vehicle/`, `apps/sim/lib/sv/`, `apps/sim/app/api/sv/`, `…/components/sv/`.
- Sửa file gốc Sim: tối thiểu, đánh dấu `// SV:` để dễ cherry-pick bảo mật.
- Không import từ `@/ee/*`; không thêm tính năng gọi dịch vụ `sim.ai`.
- Studio không compile/codegen/ghi workspace — gọi service qua BFF `/api/sv/*` (auth + ownership check).
- `graph-adapter.ts` phải thuần và có golden test (sim-state.json → graph.json).
- BlockConfig `sv_*` phải khớp BlockSpec trong core (`block-parity.test.ts`).

## Kiểm tra
Đọc package scripts và instruction local, chạy lint/test/build thực có trong service Compose (không đoán lệnh `bun run test`). CI guard theo scope M1: không path `apps/sim/ee`, không chuỗi `copilot.sim.ai`, không opcode Scratch.
