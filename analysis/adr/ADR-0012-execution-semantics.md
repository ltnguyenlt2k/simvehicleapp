# ADR-0012: Ngữ nghĩa thực thi — trigger, run instance, yield, concurrency policy (clean-room)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-WF-01, FR-BLK-03/05; [05 §3](../05-blocks-and-execution-model.md#3-ngữ-nghĩa-thực-thi-execution-semantics); Master Plan 8.7

## Context
Vehicle App là event-driven liên tục. Người dùng no-code cần mô hình dễ hiểu: "khi X xảy ra → làm các bước". Có các bước chờ (delay, stable for), lặp, song song. PO muốn tham khảo cách Scratch kết nối & runtime (nhưng AGPL ⇒ chỉ khái niệm).

## Decision
1. **Workflow** = tập trigger + chuỗi bước nối bằng control edge. **Run instance** tạo mỗi lần trigger bắn.
2. **Một strand/app**: mọi bước chạy tuần tự trên 1 event loop; giữa 2 yield point là nguyên tử.
3. **Yield points** cố định: wait, wait_until, stable_for, read(fresh), write(await ack), write_many, mỗi vòng lặp, grpc_call.
4. **Concurrency policy** là thuộc tính của trigger: `restart`, `ignore`, `queue`, `parallel`. Mặc định: signal_changed & condition → `restart`; timer → `ignore`; mqtt_message → `queue`; app_start → không áp dụng — cơ chế nằm trong runtime.
5. **Thứ tự sự kiện**: FIFO theo thời điểm nhận; timer cùng thời điểm theo `seq` tạo.
6. **Huỷ**: cancel token; mọi timer/continuation gắn token; stop scope `run|workflow|app`.
7. **An toàn vòng lặp**: `maxIterations` bắt buộc; không đệ quy.
8. **Lỗi I/O**: output `error` + handle `error`; không nối ⇒ log + policy `continue` mặc định.
9. **Clean-room**: người implement runtime/simulator **không** đọc source scratch-vm; tài liệu tham khảo duy nhất là mô tả khái niệm trong tài liệu này. Tên/opcode tự đặt (`event.*`, `control.*`…).
10. Simulator, runtime C++, runtime Python, runtime Rust **PHẢI** cài cùng ngữ nghĩa này; conformance scenario là định nghĩa thực thi được (executable spec).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Đa luồng thật cho mỗi run | Race, khó tất định, khó parity |
| Dataflow thuần (mọi thứ là stream) | Khó hiểu với người dùng no-code; khó ánh xạ sang C++ đơn giản |
| DAG chạy-một-lần như Sim | Không hợp event-driven liên tục |

## Consequences
+ Tất định, không lock trong code sinh, parity khả thi. − Bước tính toán nặng chặn strand (chấp nhận: app cấp cao, logic nhẹ; cảnh báo nếu một bước > 50 ms trong trace).

## Implementation
Conformance scenarios `simvehicleapp-contracts/fixtures/conformance/*.yaml` (≥ 30 case: restart hủy stable_for, ignore timer, queue overflow, parallel limit, cancel khi stop…) — M3 viết, M5/M6 chạy.

## Verification
Simulator và runtime C++ pass 100% conformance.

## Notes / Deviations (2026-10-04, rà source Sim v0.7.13 trước M3)
- **Block Start của Sim**: workflow mới của Sim luôn có block `starter` ("Start", thấy trong E2E M2), không thuộc mô hình §1 (trigger = các block `sv_on_*`). Đề xuất: không tạo `starter` cho workflow vehicle mới; workflow cũ có `starter` ⇒ compiler bỏ qua nếu không nối, cảnh báo nếu có edge từ nó (diagnostic mới, chỉ thêm). Cần làm cùng các trigger M3 (`sv_on_app_start` thay vai trò "khi app chạy").
- **Handle**: M2 đã chốt handle theo id canvas Sim (`source`/`error`, ADR-0011 Notes); §8 "handle `error`" khớp; các nhánh `then/else`, `ok/timeout`, `stable/broken` (M03-T07) là handle riêng của block flow, lowering ánh xạ sang IR.
- Không có source Sim nào cài ngữ nghĩa strand/yield/concurrency (executor của Sim không dùng cho vehicle, ADR-0006) ⇒ Decision §2–§7 không lệch source; được kiểm bằng simulator (M5) và conformance.
