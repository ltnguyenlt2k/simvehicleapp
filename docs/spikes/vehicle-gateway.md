# Spike M18-T09 — vehicle-gateway: proxy gRPC lọc theo method (2026-10-24)

**Câu hỏi** ([design M18 §9.2](../design/M18-test-workbench-readability-deploy.md)): một proxy HTTP/2 viết bằng Bun (`node:http2`) có:
- chuyển gRPC tới databroker của target,
- giữ được stream,
- chặn method không được phép, mà không làm hỏng các gọi khác?

**Cách chạy:** `spikes/vehicle-gateway/run.sh`, trên mạng `sv-internal` của stack dev.
- Proxy: `spikes/vehicle-gateway/proxy.ts`, chạy trên Bun 1.3.8, h2c.
- Client: `client.ts`, dùng `@grpc/grpc-js` 1.14.5 với proto `kuksa.val.v2` đã vendored.
- Target: databroker 0.5.0 của stack.

| Kiểm | read-only | read-write |
|---|---|---|
| `GetServerInfo`, `GetValue` | qua proxy, đúng dữ liệu | như read-only |
| `Actuate` | **proxy từ chối**: `PERMISSION_DENIED` (7) "…Actuate is not allowed by this deployment" | qua proxy; databroker trả `UNAVAILABLE` (14) "Provider … does not exist" (stack dev không có provider), status được truyền nguyên vẹn |
| `Subscribe` (server stream) | giá trị đầu, rồi giá trị inject `77` từ signal-gateway về tới client | như read-only |
| Client huỷ stream | proxy đóng stream phía upstream, không crash | như read-only |

**Hai lỗi tìm ra và đã sửa trong spike:**
1. Phản hồi *trailers-only* (lỗi gRPC không có body) mang `grpc-status` ngay trong header, kèm END_STREAM. Proxy phải trả lại đúng các header đó và đóng stream. Nếu không, client chỉ thấy "Received HTTP status code 200".
2. `NGHTTP2_CANCEL` khi client huỷ Subscribe làm Bun crash vì không có handler `error`. Phải bắt lỗi ở cả hai phía và đóng phía kia.

**Kết luận:** dùng được Bun `node:http2`, không cần Node runtime riêng. Service `vehicle-gateway` của M18-T09 dựa trên proxy này, thêm:
- TLS và token tới target;
- allowlist method theo deployment;
- kiểm path actuator của `Actuate`, có giải mã protobuf của request;
- audit.

Path actuator nằm trong body protobuf của request; spike chưa giải mã body này. Chưa đo tải nhiều stream đồng thời.
