# ADR-0046: Per-run runtime stack & multi-user — hoãn; không nới luật "không docker.sock" khi chưa có quyết định PO

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L0 System
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — **cần PO quyết** (chạm luật cứng AGENTS §2.10)
- **Related:** [ADR-0032](ADR-0032-auth-and-tenancy.md) §4, [ADR-0024](ADR-0024-databroker-api-and-runtime-stack.md), [ADR-0025](ADR-0025-headless-velocitas-toolchain.md), [ADR-0044](ADR-0044-standalone-service-apps.md); [phases/M14](../phases/M14-services-curated-multiuser.md) #4

## Context
- v1 (ADR-0032 §4): một runtime stack dùng chung cả instance (databroker theo release, MQTT, signal-gateway), **một Run
  active** (orchestrator 409 `activeRun`); app chạy trong container toolchain sẵn có; workspace volume chung.
- Per-run stack (databroker + MQTT + app riêng mỗi Run/người) cần **tạo/huỷ container động**. Luật cứng 10: Compose là mode
  chạy duy nhất, **không mount `/var/run/docker.sock`**.
- Các đường khả dĩ: (a) docker socket proxy giới hạn API (vẫn là quyền điều khiển Docker daemon ⇒ trái tinh thần luật 10);
  (b) Kubernetes (Job/Pod theo Run) — đổi mode chạy khỏi Compose; (c) pool cố định N stack định nghĩa sẵn trong Compose
  (`sv-run-1…N`), orchestrator cấp phát — không cần quyền Docker.

## Decision
1. **Không** mount docker.sock, **không** dùng socket proxy, **không** chuyển K8s trong phạm vi hiện tại.
2. Khi cần đa người dùng chạy đồng thời: phương án ưu tiên là **pool stack tĩnh** (c): profile Compose `multi-run` khai
   báo N bộ {databroker, mosquitto, signal-gateway, runner} cố định; orchestrator thay khoá "1 Run" bằng cấp phát slot
   (hết slot ⇒ 409 kèm hàng đợi); mỗi slot một network nội bộ riêng. Workspace volume theo user là thay đổi riêng
   (quota, quyền) — đi cùng.
3. Hoãn hiện thực tới khi PO xác nhận nhu cầu (số người dùng đồng thời) và chấp thuận ADR này.

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| docker.sock / socket proxy | Linh hoạt, tạo stack theo yêu cầu | Quyền root-tương-đương trên host | Trái luật cứng 10 |
| Kubernetes | Chuẩn đa tenant | Bỏ Compose, vận hành nặng | Ngoài phạm vi sản phẩm hiện tại |
| Pool tĩnh trong Compose (chọn khi cần) | Không quyền Docker, đúng luật | N cố định, tốn RAM khi rảnh | — |

## Consequences
- Tích cực: giữ mô hình bảo mật; có lộ trình không vi phạm luật cứng.
- Tiêu cực / nợ: v1 vẫn một Run active; team lớn phải chờ.
- Ảnh hưởng module (khi làm): orchestrator (slot), velocitas-stack/compose (profile `multi-run`), signal-gateway (theo slot), studio (hàng đợi).

## Implementation
| Task | Module | Milestone |
|---|---|---|
| PO xác nhận nhu cầu + chấp thuận | — | chờ PO |
| Profile `multi-run` + cấp phát slot | stack, orchestrator | sau |

## Verification
Khi làm: 2 user Run đồng thời trên 2 slot, trace/log không lẫn; slot thứ N+1 ⇒ 409 + hàng đợi; smoke không cần docker.sock.

## Notes / Deviations
