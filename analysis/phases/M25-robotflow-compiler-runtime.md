# M25: RobotFlow compiler + codegen Python + runtime `rfrt` + scenario

> **ADR:** [0067](../adr/ADR-0067-robotflow-compiler-and-python-runtime.md). **Thiết kế:** [robotflow.md](../../docs/design/robotics/robotflow.md).
> **Phụ thuộc:** gate M23 PASS (runtime cần broker + mock). Có thể làm song song M24; conformance trên ROS chờ M24.

## Mục tiêu
Từ `robotflow.v1`, compiler sinh app Python tất định. App chạy trên `rfrt` qua Protobus, có log và trace. Scenario test được chạy trên mock.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Schema `robotflow.v1`, `block.v1`, `rfir.v1`, `rfevent.v1`, `scenario.v1`, `rflow-lock.v1` + catalog `RF*` | robotics/contracts | — | Contract test |
| T02 | Registry 25 block (YAML) + tài liệu block sinh tự động | robotics/robotflow | T01 | Mọi block có cổng/props/ngữ nghĩa đủ |
| T03 | Biểu thức (Pratt) + đơn vị + kiểm kiểu | robotics/robotflow | T01 | Ca lỗi `RF2xxx` |
| T04 | Stage compiler + safety-lint + IR | robotics/robotflow | T02–T03 | Golden IR RW-A…F |
| T05 | Codegen Python + `rflow.lock.json` | robotics/robotflow | T04 | Build ×2 bytes giống; golden code |
| T06 | Runtime `rfrt`: behavior scheduler, client Protobus, setpoint timer, trace `rfevent.v1`, kiểm hash | robotics/rfrt | T05, M23 | Unit + chạy RW-A trên mock |
| T07 | Scenario runner trên mock + conformance RW-A…F ×2 | robotics | T06 | 6/6 PASS hai lượt |
| T08 | HTTP service `robotflow`: `/lint`, `/build`, `/blocks`, `/rss/catalog`, `/healthz` (thuần, không chạy code) | robotics/robotflow | T05 | Contract HTTP test; lint p95 < 400 ms với 150 block |
| T09 | CLI `sr build/run` (dev) để chạy app trên mock/ROS không cần GUI | robotics/scripts | T06 | Dùng được trong báo cáo |
| T10 | Gate + báo cáo M25 (kèm RW-A/B/D chạy trên `ros-sim` nếu M24 đã PASS) | docs | T01–T09 | `docs/reports/M25.md` |

## Acceptance Gate
- Conformance mock 6/6 ×2.
- Tất định.
- Ca lỗi cho mọi mã `RF*` đã công bố.
