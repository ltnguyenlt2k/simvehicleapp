# M27: Hiệu năng và hồ sơ máy cấu hình thấp

> **ADR:** [0070](../adr/ADR-0070-robotics-performance-budget-low-spec.md). **Thiết kế:** [performance-and-video.md §1–3](../../docs/design/robotics/performance-and-video.md).
> **Phụ thuộc:** gate M26 PASS; dog R4 W5 (đo kết hợp phía dog) làm cùng.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Profile compose `robot-lite` (studio + DB + realtime + AI tuỳ chọn + robotics + dog) + giới hạn mọi container | robotics, studio overlay | — | Khởi động `sr` < 20 s (DEV) |
| T02 | Script đo: `docker stats`, trễ broker p50/p95/p99, FPS canvas, long task studio, FPS camera/WebGL Robot Zoo (công cụ R3 của dog) | robotics/scripts | T01 | Xuất JSON + markdown |
| T03 | Đo DEV: RW-D 10 phút trên `ros-sim` | — | T02 | Bảng ngân sách |
| T04 | Đo LOW (4 CPU + cap 6 GiB) | — | T02 | Bảng ngân sách |
| T05 | Tối ưu chỗ FAIL (không nới ngưỡng an toàn), đo lại; giữ lượt FAIL | robotics, studio | T03–T04 | Mọi dòng PASS |
| T06 | Gate + báo cáo M27 | docs | T05 | `docs/reports/M27.md` |

## Acceptance Gate
Mọi dòng ngân sách ADR-0070 PASS trên DEV và LOW; Robot Zoo DEV giữ ≥ 90 % FPS camera R3.
