# M22: RSS v0.1 (Robotic Signal Specification) + catalog đa spec

> **Yêu cầu:** PO 2026-10-27 — "tương tự vss path hãy tạo rss path… trước mắt là dog robot" (tham khảo `ltnguyenlt2k/dog-ros2-simulation`).
> **Thiết kế:** [docs/design/M22-robotics-extension.md](../../docs/design/M22-robotics-extension.md) §2, §4, §9.
> **ADR:**
> - [0064](../adr/ADR-0064-robotics-domain-signal-spec.md) (miền robot);
> - [0065](../adr/ADR-0065-rss-robotic-signal-specification.md) (RSS);
> - [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) (chỉ phần overlay mapping).
>
> Cả ba **Proposed — chờ PO xác nhận**. Không implement khi ADR chưa Accepted (luật cứng 7, 9). Spike T01, T06 làm được trước.
>
> **Phụ thuộc:** M21 đóng (D1). Repo dog @ `9adea9be` (ghim; đổi SHA ⇒ cập nhật design §2.1).
>
> **Nguyên tắc:**
> - RSS viết từ đầu, không chép VSS;
> - JSON sinh ra tất định;
> - VSS cũ không đổi một byte;
> - mọi thay đổi contract chỉ thêm.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | **Spike S-R2:** vss-tools (tag ghim, MPL-2.0, chỉ dùng như tool build) biên dịch vspec gốc `Robot` có `instances`, `allowed`, overlay với thuộc tính mở rộng `ros2` | spikes | — | `docs/spikes/M22-rss-spike.md`: lệnh, tag, bytes ×2 giống nhau |
| T02 | Viết vspec RSS v0.1 (≈ 75 leaf, 14 nhánh theo design §4); quy ước lệnh; script build `rss_v0.1.json` tất định | rss-spec (mới) | T01 | Build ×2 cùng bytes; mọi leaf có description/đơn vị; lint quy ước lệnh |
| T03 | Đơn vị `rad`, `rad/s` (+ `s` nếu thiếu) trong core units; dimension góc | core/units | — | Unit test; golden VSS không đổi |
| T04 | Catalog đa spec: `GET /catalog/{spec}/{release}/…`, route cũ là alias VSS; seed `RSS v0.1`; search/tree theo spec | core/vss → signal-catalog | T02 | Test API cả hai spec; snapshot VSS không đổi |
| T05 | Contracts: `signalSpec` (tuỳ chọn, mặc định VSS) trong workflow-graph, scenario, IR, openapi catalog/orchestrator; fixture RSS | contracts | T04 | Additive + CHANGELOG; contract test tương thích ngược |
| T06 | **Spike S-R1:** KUKSA 0.7.1 (digest BASELINE) nạp `rss_v0.1.json`; Get/Subscribe/Actuate `Robot.*` qua `kuksa.val.v2`, actuator string có `allowed` | spikes | T02 | Log lệnh + kết quả trong báo cáo spike; ADR-0065 Notes |
| T07 | Overlay mapping dog `mapping.vspec` (bản nháp) + bảng truy vết: mỗi topic dog (design §2.1) ⇒ leaf RSS hoặc "ngoài phạm vi" có lý do | rss-spec, protobus | T02 | Bảng truy vết 100 % topic; review |
| T08 | Studio: toolbar hiện cây RSS **chỉ đọc** khi bật cờ `SV_ROBOTICS=1` (chưa có block) | studio | T04 | Vitest; E2E mock |
| T09 | Tài liệu RSS: `docs/rss/README.md` (cây, đơn vị, quy ước lệnh, cách đề xuất leaf mới), cập nhật glossary | docs | T02 | Link check |
| T10 | Đóng milestone: gate, báo cáo `docs/reports/M22.md` | all | T01–T09 | Gate PASS |

## Acceptance gate
- **Bắt buộc:**
  - `rss_v0.1.json` tất định ×2;
  - KUKSA 0.7.1 nạp được (S-R1);
  - catalog trả cây RSS và VSS song song; golden VSS/IR GW-A..G **không đổi**;
  - bảng truy vết topic dog 100 %.
- **Không yêu cầu ở M22:** block, codegen, ROS 2.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| vss-tools không nhận gốc khác `Vehicle` hoặc overlay mở rộng | S-R2 trước. Phương án: viết bộ biên dịch vspec→JSON tối thiểu trong `rss-spec` (Apache-2.0, viết từ đầu). |
| Repo dog đổi topic/JSON | Ghim SHA; test fixture chép nguyên văn có ghi nguồn |
