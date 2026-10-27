# M24: Compiler, block và simulator cho miền robot

> **Yêu cầu:** PO 2026-10-27 — workflow kéo thả cho robot (di chuyển, pilot, nhảy, chào giơ chân), có log và kịch bản.
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §6, §7.
> **ADR:** [0064](../adr/ADR-0064-robotics-domain-signal-spec.md), [0068](../adr/ADR-0068-robot-blocks-commands-and-scenarios.md) (Proposed — chờ PO xác nhận).
>
> **Phụ thuộc:** gate M22 PASS. Chạy song song được với M23.
>
> **Nguyên tắc:**
> - không opcode IR mới;
> - golden GW-A..G không đổi một byte;
> - mã diagnostic chỉ thêm;
> - mọi block robot có timeout.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Compiler: `SignalLookup(spec, release, paths)`, regex template theo gốc spec, `modelHash` theo spec, `SIGNAL_SPEC_MISMATCH` | core/compiler | M22-T05 | Golden GW-A..G không đổi; test trộn spec |
| T02 | 5 block robot: `semantics.md` + `spec.json` (`sv_robot_safety`, `_move`, `_go_to`, `_motion`, `_cancel`) | core/blocks | T01 | Validate theo `block-spec.v1`; test mỗi prop required |
| T03 | Lowering về opcode có sẵn + golden IR RW-A..RW-D (template ở design §7) | core/compiler | T02 | Tất định ×2; snapshot |
| T04 | Simulator: `robot-sim-profile.json` (điều kiện nhận, chuỗi phase, hiệu ứng), scenario ghi đè vòng đời; conformance robot (REJECTED/FAILED/timeout/STOP) | core/simulator, contracts | T03 | Conformance robot C-R01..C-R08 PASS |
| T05 | Diagnostics mới (ADR-0068 §5) + catalog contracts + `DIAGNOSTICS_CATALOG.md` | contracts, core | T01 | Test "cố ý sai" mỗi mã; diagnostics-guard |
| T06 | Test tab: scenario RSS, `expect.writes` trên lệnh robot, Generate tests cho nhánh succeeded/failed/timeout | core, studio | T04 | Vitest + test core |
| T07 | Đóng milestone: báo cáo `docs/reports/M24.md` | all | T01–T06 | Gate PASS |

## Acceptance gate
- Golden IR robot ×2 tất định; GW-A..G không đổi.
- Conformance robot 8/8.
- Diagnostics mới có test, catalog cập nhật.
- Simulate RW-A..RW-D cho Flow đúng nhánh, có nhãn "simulated lifecycle".

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Lowering sinh nhiều node làm Flow khó đọc | Flow gộp theo `src.blockId` (đã có); test hiển thị |
| Profile vòng đời giả lập lệch robot thật | Thời lượng động tác lấy từ số đo M23; nhãn rõ trong UI |
