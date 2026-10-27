# M26: Studio miền Robot + E2E full luồng + video

> **Yêu cầu:** PO 2026-10-27 — "mục tiêu cuối cùng là tôi có thể kéo thả workflow tạo một kịch bản… các tín hiệu này sẽ truyền đúng các path tín hiệu rss rồi qua protobus convert ra ros2 và vị trí tương ứng có thể nhận hoặc điều khiển đúng với design tại workflow".
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §7, §8.
> **ADR:** 0064, 0068 (Proposed — chờ PO xác nhận).
>
> **Phụ thuộc:** gate M25 PASS.
>
> **Nguyên tắc:** AGENTS §4 bước 7 bắt buộc:
> - `@live` full luồng với workflow phức tạp;
> - video nhịp người dùng;
> - README + user guide.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Tạo app chọn **Miền: Xe (VSS) / Robot (RSS)**, chọn robot đích (profile protobus); bỏ cờ `SV_ROBOTICS` | studio, orchestrator | M25 | Vitest + E2E mock |
| T02 | Toolbar miền Robot: cây RSS, nhóm block Robot (BlockConfig 5 block), ẩn block riêng xe; `block-parity.test.ts` | studio | T01 | Parity test; E2E kéo thả từng block |
| T03 | Mẫu workflow RW-A..RW-D trong studio (tạo từ template) | studio | T02 | E2E tạo từ mẫu |
| T04 | Run robot: nút **STOP robot** luôn hiện; trạng thái lease; link "Mở Robot Zoo" (`127.0.0.1:8090`); Flow nhãn "simulated lifecycle" khi Simulate | studio | T02 | E2E mock + live |
| T05 | Trợ lý AI: MCP tool catalog trả RSS theo miền; WorkflowPatch dùng block Robot; eval robot (fake + model thật của PO) | simvehicleapp-ai | T02 | Eval robot ≥ 8/10 với model thật |
| T06 | E2E `@live` full luồng robot: tạo app robot ⇒ kéo thả RW-B (pilot) + RW-A (chào) ⇒ Test ⇒ SynCode ⇒ Run trên dog sim ⇒ robot đi/chào thật ⇒ STOP ⇒ Export | studio/e2e | T03–T05 | PASS ×3 liên tiếp local |
| T07 | Video `scripts/sv demo-video --robot` (nhịp người dùng, chia màn hình studio + Robot Zoo); README + `docs/user-guide/robotics.md` | scripts, docs | T06 | Video + tài liệu khớp UI |
| T08 | Đóng milestone: báo cáo `docs/reports/M26.md`, ROADMAP | all | T01–T07 | Gate PASS |

## Acceptance gate
- `@live` full luồng robot PASS ×3.
- Video mới, README và user guide cập nhật.
- Eval trợ lý robot đạt ngưỡng.
- STOP/lease có test E2E.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Quay video cần cả stack dog + studio trên máy 11 GB | Một stack studio; dog chạy profile tối thiểu (không RViz); đo RAM trước |
| Người dùng nhầm Simulate (vòng đời giả lập) với robot thật | Nhãn rõ + tài liệu |
