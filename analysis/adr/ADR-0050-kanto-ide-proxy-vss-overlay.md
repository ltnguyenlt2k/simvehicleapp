# ADR-0050: Hoãn Kanto deployment, reverse proxy + SSO forward-auth cho IDE, VSS overlay OEM (M14 #8–#10)

- **Status:** Accepted (PO chấp thuận toàn bộ 2026-10-25)
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
- 2026-10-14: **#10 được làm** theo yêu cầu PO 2026-10-13 — [ADR-0052](ADR-0052-custom-vss-models.md) (release `vX.Y-<name>`, overlay JSON, `scripts/sv vss`, databroker-custom, vss-sync project); #8, #9 vẫn hoãn.
- **2026-10-25 (M21 D14, PO chấp thuận toàn bộ): #8 Kanto — làm phía deploy, không chạy Kanto trong stack.**
  - **Lý do:** chạy kanto-cm trong stack cần quyền điều khiển containerd/Docker (luật cứng 10); giá trị thật là đưa app lên xe.
  - **Image push** (`POST /projects/{id}/images`, M18) trả thêm `kanto`: descriptor container-management đúng kiểu `types.Container` của kanto-cm v1.0.0, tức file trong `deployment.ctr_dir`. Đã kiểm source tag `v1.0.0`:
    - `deployment.go` duyệt thư mục và gọi `util.ReadContainer`;
    - field JSON lấy theo `container_name`, `image.name`, `host_config.network_mode`, `restart_policy.type`, `config.env`.
  - **Nội dung descriptor:**
    - image theo digest;
    - mạng host;
    - `unless-stopped`;
    - env của app (`SDV_VEHICLEDATABROKER_ADDRESS`, `SDV_MQTT_ADDRESS`, `KUKSA_DATABROKER_API`/`SV_DATABROKER_API=kuksa.val.v2`, `SV_TRACE_LEVEL=trigger`).
  - **Tất định:** cùng image ⇒ cùng bytes.
  - **Studio:** hộp thoại Deploy → Container image có nút **Download Kanto descriptor**.
  - **Contract:** additive (CHANGELOG contracts).
  - **Test:** `kanto.test.ts`, `runs-deploy.test.ts`.
  - **Chưa kiểm** trên một xe chạy Kanto thật: không có thiết bị.
- **2026-10-25 (M21 D15, PO chấp thuận toàn bộ): #9 IDE proxy + SSO forward-auth — làm theo Decision §2.**
  - **Proxy:** profile `remote-ide`, service `ide-proxy`:
    - image `caddy:2.11.7-alpine@sha256:eb4d35b7…`, cấu hình tĩnh `modules/ide-vscode/proxy/Caddyfile`, không docker.sock;
    - cổng bind `127.0.0.1:${SV_IDE_PROXY_PORT:-8443}`. TLS do bộ kết thúc của host lo (luật cứng 10 giữ nguyên).
  - **Một origin:** studio `/`, realtime `/socket.io/`, code-server `/ide/cpp/`, `/ide/python/`. Nhờ vậy cookie phiên studio đi cùng request IDE.
  - **Forward-auth:** `GET /api/sv/ide/authorize` trên studio (contract `svIdeAuthorizeContract`) trả 200 cho người đã đăng nhập, 401 nếu không. SSO (`@better-auth/sso`, ADR-0032) đi qua chính phiên này.
  - **code-server giữ mật khẩu** (thêm một lớp).
  - **Giới hạn:** quyền theo phiên, không theo project. Code-server mở volume workspace chung.
  - **Hướng dẫn:** [DEPLOY](../../docs/DEPLOY.md) mục "Mở studio và IDE từ máy khác".
