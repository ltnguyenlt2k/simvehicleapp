# M28: E2E live, video full luồng trung thực, tài liệu, baseline

> **ADR:** [0071](../adr/ADR-0071-robotics-acceptance-and-honest-video.md). **Thiết kế:** [performance-and-video.md §4](../../docs/design/robotics/performance-and-video.md).
> **Phụ thuộc:** gate M27 PASS; dog R4 W2/W3 xong (cần cho RW-B/RW-C/RW-E trên ROS), W6 (Robot Zoo hiển thị người điều khiển WORKFLOW).

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | E2E `@live` robotics: RW-A…RW-F trên GUI studio + `ros-sim`, ba lượt liên tiếp | studio e2e | — | 3/3 PASS cùng commit |
| T02 | Fault `@live`: Stop giữa chừng, operator STOP ở Robot Zoo, restart service không Start lại | studio e2e | T01 | PASS |
| T03 | `sr demo-video`: Xvfb + 2 cửa sổ + x11grab + Playwright nhịp người dùng + chữ chặng | robotics/scripts | T01 | Chạy tái lập được |
| T04 | Manifest + kiểm tự động (decode, đối chiếu `request_id` với audit Protobus + `workflow/ack` dog) | robotics/scripts | T03 | Kiểm PASS |
| T05 | Quay video final `docs/media/robotics/full-flow.mp4` (+ GIF ngắn); xem từng chặng | docs/media | T04 | Manifest + biên bản xem |
| T06 | README chính (mục Robotics + video), `docs/user-guide/robotics.md` hoàn chỉnh, CHANGELOG | docs | T05 | Khớp UI hiện tại |
| T07 | Báo cáo M28 + baseline tag local (push khi PO cho phép) | docs | T06 | `docs/reports/M28.md` |

## Acceptance Gate
Bốn điều kiện ADR-0071 §1 đủ. Video cũ của bản thử không được dùng.
