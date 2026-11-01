# robotics/ — các lớp thực thi độc lập cho workflow robot

Catalog tín hiệu RSS → broker Protobus (+ provider mock / cầu ROS 2) → compiler RobotFlow → runtime `rfrt` → control API.
- **Soạn workflow:** trong studio SimVehicleApp hiện có; thư mục này **không có GUI**.
- **Robot:** repo [dog-ros2-simulation](https://github.com/ltnguyenlt2k/dog-ros2-simulation), chỉ giao tiếp qua ROS 2.
- **Thiết kế:** [docs/design/robotics](../docs/design/robotics/README.md).

| Thư mục | Lớp | Giao diện cung cấp |
|---|---|---|
| `contracts/` | JSON Schema, proto `protobus.v1`, catalog mã lỗi | file có version |
| `rss/` | spec RSS (YAML) + công cụ `rssc` | `rss-catalog.v1.json` |
| `protobus/` | broker, provider (`mock`, `ros2`) | gRPC `protobus.v1` |
| `robotflow/` | compiler `rflowc` | HTTP `/lint` `/build` |
| `rfrt/` | runtime cho app sinh ra | package Python |
| `control/` | API build/deploy/run + runner | HTTP nội bộ (BFF của studio gọi) |
| `scripts/` | CLI `sr`, guard ranh giới, script video | — |
| `tools/` | image Python và recorder ghim phiên bản | — |

```bash
robotics/scripts/sr build-dev   # build image dev/test
robotics/scripts/sr test        # unit/contract test trong container
robotics/scripts/sr precheck    # guard ranh giới repo
robotics/scripts/sr rssc validate
```
