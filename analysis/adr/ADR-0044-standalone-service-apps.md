# ADR-0044: Standalone service app (1 workflow → 1 Vehicle App) — hoãn, phụ thuộc ADR-0043

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L1 Subsystem
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận
- **Related:** [ADR-0022](ADR-0022-cpp-codegen-strategy.md), [ADR-0023](ADR-0023-velocitas-project-layout-and-manifest.md), [ADR-0026](ADR-0026-workspace-service.md), [ADR-0043](ADR-0043-grpc-service-interface.md); [phases/M14](../phases/M14-services-curated-multiuser.md) #3 (Master Plan Phase 25)

## Context
- Hiện tại: một project = **một** Vehicle App (một template Velocitas, một AppManifest, một process) chứa mọi workflow
  của project (ADR-0022/0023); workflow giao tiếp với nhau qua tín hiệu VSS, biến không chia sẻ, MQTT topic.
- "Standalone service" = tách một workflow thành app riêng (process, AppManifest, image/deploy riêng) và nối các app bằng
  pub/sub (đã có: `sv_mqtt_publish`/`sv_on_mqtt`) hoặc gRPC (ADR-0043, chưa có).
- Tách app nhân đôi: project Velocitas trên đĩa, SynCode/toolchain job, Run (process + log/trace), export, IDE.

## Decision
1. Đơn vị vẫn là **project = một Velocitas app**. "Standalone service" hiện thực bằng **nhiều project** trong một
   workspace nói chuyện qua MQTT (đã chạy được hôm nay) — tài liệu hoá như mẫu, không thêm cơ chế mới.
2. Chạy nhiều app cùng lúc trong stack dev (Run nhiều project song song, cùng databroker/MQTT) là phần việc của ADR-0046
   (per-run stack); khi đó mới cân nhắc "project group" (SynCode/Run/export cả nhóm).
3. Giao tiếp gRPC giữa app phụ thuộc ADR-0043 (`provided` sinh server SDK).
4. Hoãn mọi thay đổi code tới khi ADR-0043 và ADR-0046 được chấp thuận.

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Một project sinh nhiều app | Một nơi quản lý | Phá layout Velocitas (một `.velocitas.json`/AppManifest), workspace/toolchain/run/export đều đổi | Chi phí lớn, chưa có nhu cầu đo được |
| Nhiều project + MQTT (chọn) | Chạy được ngay, đúng Velocitas | Run đồng thời nhiều project còn giới hạn (ADR-0046) | — |

## Consequences
- Tích cực: không thay đổi kiến trúc; người dùng có cách làm ngay.
- Tiêu cực / nợ: chưa có SynCode/Run/export theo nhóm.
- Ảnh hưởng module: docs (user guide) hôm nay; orchestrator/workspace khi ADR-0046 xong.

## Implementation
| Task | Module | Milestone |
|---|---|---|
| Hướng dẫn "hai project nói chuyện qua MQTT" | docs/user-guide | M15 (cùng E2E) |
| Project group (SynCode/Run/export) | orchestrator, workspace, studio | sau ADR-0046 |

## Verification
Khi làm: E2E hai project, app A publish ⇒ app B nhận và ghi actuator (live).

## Notes / Deviations
