# ADR-0050: Hoãn Kanto deployment, reverse proxy + SSO forward-auth cho IDE, VSS overlay OEM (M14 #8–#10)

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L1 Subsystem
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận
- **Related:** [ADR-0024](ADR-0024-databroker-api-and-runtime-stack.md), [ADR-0028](ADR-0028-ide-code-server.md), [ADR-0032](ADR-0032-auth-and-tenancy.md), [ADR-0010](ADR-0010-vss-catalog.md); [phases/M14](../phases/M14-services-curated-multiuser.md) #8–#10

## Context
- **#8 Kanto** (`runtime-kanto`, `deployment-kanto` của Velocitas): chạy app trong Eclipse Kanto container management —
  cần quyền điều khiển container (containerd/Kanto) trong stack ⇒ cùng vướng luật cứng 10 như ADR-0046; giá trị chính là
  mô phỏng deploy lên xe, ngoài vòng lặp no-code hiện tại.
- **#9 Reverse proxy + SSO forward-auth cho IDE**: code-server hiện bind `127.0.0.1` với mật khẩu/token (ADR-0028), chỉ
  dùng local; SSO backend `@better-auth/sso` đã có (ADR-0032 §1). Chỉ cần khi IDE mở ra mạng ngoài.
- **#10 VSS overlay OEM** (vss-tools): catalog hiện nạp release JSON đã vendored (ADR-0010); overlay cần pipeline
  `vss-tools` sinh JSON + quản lý `modelHash` theo overlay, và mọi backend đã dùng path VSS động nên không đổi codegen.

## Decision
1. **#8 Kanto: hoãn** — chỉ làm cùng/hoặc sau ADR-0046 (cùng vấn đề quyền điều khiển container).
2. **#9 IDE proxy + SSO: hoãn** tới khi có yêu cầu truy cập IDE từ xa; khi làm: một reverse proxy (Caddy/Traefik trong
   Compose, không docker.sock — cấu hình tĩnh) + forward-auth gọi BFF studio kiểm session/quyền project; code-server
   không bind ra ngoài.
3. **#10 VSS overlay: hoãn** tới khi có overlay OEM thật; khi làm: overlay là release mới `<base>+<overlay>` do
   `vss-tools` sinh offline (pin version vss-tools), vendored như release, `modelHash` riêng — không đổi IR/codegen.

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Làm ngay cả ba | Đủ backlog | Không có nhu cầu đo được; #8 trái luật 10 | Hoãn có điều kiện |

## Consequences
Không đổi code; điều kiện mở lại ghi rõ cho từng mục.

## Verification
Khi làm: #9 truy cập IDE qua proxy không session ⇒ 401, user không quyền project ⇒ 403; #10 project trên overlay release
compile + SynCode + parity với signal của overlay.

## Notes / Deviations
