# M22: Nền móng `robotics/` + RSS v0.1 + spike robot

> **Yêu cầu:**
> - PO 2026-10-27: RSS path cho dog robot;
> - PO 2026-10-28: stack robot **độc lập, viết từ đầu**.
>
> **Thiết kế:** [design](../../docs/design/M22-robotics-extension.md) §1, §2, §4, §9.
> **ADR:** [0064](../adr/ADR-0064-robotics-independent-stack.md), [0065](../adr/ADR-0065-rss-robotic-signal-specification.md), [0066](../adr/ADR-0066-protobus-rss-ros2-bridge.md) (spike) — Accepted for implementation 2026-10-29; gates OPEN.
>
> **Phụ thuộc:** PO Accepted ADR-0064, 0065. Spike T07 cần stack dog chạy được local (`tools/dev start` của repo dog).
>
> **Nguyên tắc:**
> - không file nào trong `robotics/**` tham chiếu `modules/**`, `scripts/sv`, KUKSA, Velocitas, VSS;
> - được sửa repo dog theo ủy quyền 2026-10-29, qua interface và gate riêng; không import source chéo.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Khung `robotics/`: `AGENTS.md` (luật riêng, gồm an toàn robot), `README.md`, `compose.yaml` (project `sr`, chưa có service nặng), `scripts/sr` (`build/up/down/smoke/precheck`, `down` không bao giờ `-v`), `.github/workflows/robotics.yml` lọc `robotics/**`, guard "không phụ thuộc chéo" | robotics | — | `sr precheck` chạy guard; `docker compose -f robotics/compose.yaml config -q`; CI xanh |
| T02 | Contracts: JSON Schema `rss-spec.v1`, `rss-catalog.v1`; khung `diagnostics.v1.json` (dải `RSS*` cho rssc) | contracts | T01 | Schema validate fixture đúng/sai |
| T03 | Tool `rssc`: `validate`, `build` (nở instances, sinh `Status.*` cho command, canonical JSON, `catalogHash`), `docs`, `diff` | rss | T02 | Build ×2 cùng bytes; test "cố ý sai" mỗi luật (ADR-0065 Verification) |
| T04 | `units.yaml` SI REP-103 + chiều đơn vị | rss | T02 | Test đổi đơn vị cùng chiều; đơn vị lạ ⇒ lỗi |
| T05 | RSS v0.1 Go2 (design §4): ≈ 80 sensor/attribute, 1 setpoint, 7 command, có min/max/maxAgeMs/ttl/timeout | rss | T03, T04 | `rssc validate` PASS; review từng nhánh với topic thật |
| T06 | Ma trận truy vết 48 topic dog ↔ RSS: mỗi topic có node RSS hoặc "ngoài phạm vi" + lý do; nháp mapping profile `dog-go2-sim` | rss, protobus | T05 | 100 % topic; fixture message/JSON có ghi nguồn SHA |
| T07 | Spike S-R1 (DDS từ container ngoài compose dog), S-R2 (`dog_interfaces` trong image Humble digest ghim), S-R3 (envelope: `config_hash`, sim time, ack; đo thời lượng 5 động tác) | protobus/spikes | T01 | Báo cáo `robotics/docs/spikes/M22.md` có lệnh + output; yêu cầu phía repo dog (nếu có) ghi rõ |
| T08 | Tài liệu tham chiếu RSS (sinh bằng `rssc docs`), báo cáo `docs/reports/M22.md`, ROADMAP | rss, docs | T01–T07 | Gate PASS |

## Acceptance gate
1. Guard độc lập PASS trên CI.
2. `rssc build` tất định ×2. Test lỗi đủ.
3. Ma trận truy vết 100 %.
4. Ba spike S-R1..S-R3 có kết luận và bằng chứng. Nếu S-R1 FAIL: có phương án đã thống nhất với repo dog trước khi vào M24.

## Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| DDS không thấy nhau (RR1) | S-R1 sớm; phương án peer phía dog |
| Spec quá rộng, chậm | Chỉ topic có trong design §2.1; còn lại "ngoài phạm vi" |
| Máy thiếu RAM khi chạy dog | Dog profile tối thiểu (không RViz), không chạy stack xe cùng lúc |


## Amendment 2026-10-29

ADR-0069 is authoritative for integration and review R01–R08. Implementation authorized; no runtime gate has passed yet. M25 compiler/mock gate may proceed after M23; combined live acceptance requires M24. M26 technical gate precedes M27 final UI/video acceptance. CI source artifacts must be available before image gates.


## Actual checkpoint 2026-10-29

T01 local foundation/build/precheck PASS, GitHub CI pending; T02–T06 local validation PASS (15 tests, 113 nodes, complete 48 topics); T07 S-R1–S-R3 actual PASS. T08 report exists but overall gate OPEN until CI. See ../../docs/reports/M22.md. M23 NOT STARTED.

2026-10-29 closure: scoped Robotics CI run 40874429999 succeeded at 0abd1585. M22 gate PASS; the checkpoint above is historical. General vehicle CI dependency failure is addressed separately in the AI security report.
