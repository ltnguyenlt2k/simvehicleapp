# M22: Nền robotics + RSS v0.1 + spike

> **Yêu cầu:** PO 2026-10-27 (R1–R4), nhắc lại 2026-11-01 kèm R5 hiệu năng, R6 video, R7 AI. Xem [design robotics §0](../../docs/design/robotics/README.md).
> **Thiết kế:** [README](../../docs/design/robotics/README.md), [rss-v0.1](../../docs/design/robotics/rss-v0.1.md).
> **ADR:** [0064](../adr/ADR-0064-robotics-architecture-shared-gui-independent-execution.md), [0065](../adr/ADR-0065-rss-robotic-signal-specification.md), [0070](../adr/ADR-0070-robotics-performance-budget-low-spec.md) (Proposed — chờ PO xác nhận).
> **Điều kiện bắt đầu:** PO cho phép code (2026-11-01 mới chỉ yêu cầu tài liệu). Gate M21 không chặn: robotics là nhánh song song, không chạm module xe trong M22.
> **Repo dog:** đọc tại commit pin (`35c45ee`), không sửa. Việc phía dog theo [dog R4](https://github.com/ltnguyenlt2k/dog-ros2-simulation/blob/main/docs/r4/README.md).

## Mục tiêu
- Khung `robotics/` độc lập, có guard ranh giới.
- RSS v0.1 (spec + catalog + tool + tài liệu tham chiếu) đối chiếu đúng với robot dog.
- Spike S-R1…S-R4 trả lời bốn rủi ro kỹ thuật trước khi viết broker/GUI.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Khung: `robotics/{README,AGENTS}.md`, `compose.yaml` (project `sr`), `scripts/sr`, CI `.github/workflows/robotics.yml` (lọc `robotics/**`), guard import chéo (`scripts/precheck.py`) | robotics | — | `docker compose -f robotics/compose.yaml config -q`; guard bắt được ca vi phạm cố ý; CI xanh |
| T02 | Schema `rss-spec.v1`, `rss-catalog.v1`, `units.yaml` | robotics/contracts, rss | T01 | ≥ 20 ca chấp nhận/từ chối |
| T03 | Spec `core` + profile `dog-go2-sim` đúng [rss-v0.1 §3](../../docs/design/robotics/rss-v0.1.md) | robotics/rss | T02 | Build ra catalog ~100 node lá, 8 command, 1 setpoint |
| T04 | `rssc validate/build/docs/diff`; tài liệu `docs/reference/rss/` | robotics/rss | T03 | Build ×2 bytes giống; docs sinh tự động |
| T05 | Đối chiếu profile với dog `contracts/ros2/topics.json` + hằng số `brain.py` tại commit pin | robotics/rss | T03 | Mọi topic nguồn tồn tại/đúng type; giới hạn ≤ Brain; báo cáo lệch |
| T06 | Spike S-R1: bridge rclpy Humble ngoài compose dog nhận `/dog1/odom`, publish thử lên topic tạm (không lệnh), quan sát discovery | robotics/protobus/spikes | T01 | ≥ 45 Hz odom 60 s; ghi rõ có cần peer phía dog không |
| T07 | Spike S-R2: broker Python tối thiểu (subscribe + set), tải 300 tín hiệu / 2.000 cập nhật/s / 20 subscriber | robotics/protobus/spikes | T01 | p95 < 20 ms, CPU < 0,5 core, RSS < 150 MiB; FAIL ⇒ ADR broker Rust trước M23 |
| T08 | Spike S-R3: 150 block giả `rf_*` trên canvas studio (nhánh spike, không merge code UI) | studio (spike) | — | ≥ 50 FPS kéo; lint giả p95 < 400 ms |
| T09 | Spike S-R4: Xvfb + 2 cửa sổ (studio + Robot Zoo) + `ffmpeg x11grab` 1600×900@25 | robotics/scripts/spikes | — | CPU recorder < 1,5 core; Robot Zoo camera giảm < 10 % |
| T10 | Báo cáo M22 + cập nhật ADR Notes, ROADMAP | docs | T01–T09 | `docs/reports/M22.md` |

## Acceptance Gate
- T01–T05 PASS trên CI.
- Bốn spike có số đo thật (kể cả FAIL) trong báo cáo.
- Quyết định từ spike ghi vào ADR-0066/0070 Notes.

## Rủi ro
- S-R1 FAIL do peers cố định ⇒ cần dog W1 thêm peer trước M24.
- S-R2 FAIL ⇒ đổi ngôn ngữ broker (ADR mới), M23 lùi.
