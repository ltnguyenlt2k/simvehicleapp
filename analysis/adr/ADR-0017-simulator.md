# ADR-0017: Simulator IR với virtual clock (TypeScript, trong `simvehicleapp-core`)

- **Status:** Proposed — triển khai M5 theo uỷ quyền PO 2026-10-06, **chờ PO chấp thuận** · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-RUN-01; Master Plan 7.4; ADR-0006, ADR-0012

## Decision
1. Package `@simvehicleapp/simulator` (thuần TS, không I/O) + endpoint `POST /simulate` trên `compiler`; có thể chạy trong browser (Web Worker) cho phản hồi tức thì — cùng code.
2. Kiến trúc: `VirtualClock` (min-heap sự kiện theo `t`, `seq`), `Strand` giả lập, `MockVehicle` (giá trị hiện tại + lịch sử writes), `MockMqtt`, `Tracer` phát **TraceEvent v1 cùng format runtime thật** (ADR-0027).
3. **Scenario v1** (YAML/JSON): `inputs: [{t, path|topic, value}]`, `until`, `initial: {path: value}`, `expect?: {writes: [...], trace?: [...]}` — dùng chung cho simulator, runtime conformance, integration test, parity.
4. Không giả lập độ trễ mạng mặc định; tuỳ chọn `latency: {read: 5, write: 5}` ms để phát hiện race logic.
5. Giới hạn: `until ≤ 24h virtual`, tối đa 1e6 sự kiện ⇒ `SIM_LIMIT_REACHED`.
6. UI: Scenario editor (bảng + ghi lại từ Signals panel), Timeline (signals & writes), Replay overlay.

## Mở rộng
Giá trị mảng (`T[]`) trong scenario/mock dùng JSON array thuần (đã tự nhiên hỗ trợ bởi format scenario hiện có); Simulator phải cài đúng `array.len/at/contains` giống runtime thật để giữ parity — xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Chạy binary C++ với MockVehicle cho simulate | Cần build (chậm) |
| Dùng Sim executor | Ngữ nghĩa khác (ADR-0006) |

## Verification
Pass 100% conformance; GW-A..G expected.trace khớp; benchmark 10 phút virtual < 1 s.

## Notes / Deviations
**2026-10-07 — triển khai M05-T01…T06 (`core/packages/simulator`), các điểm ngữ nghĩa ADR-0012 chưa ghi rõ, chốt bằng conformance C01–C38 + 7 golden (45/45 PASS):**
1. **Lập lịch:** min-heap theo `(t, seq)`; input của scenario được xếp trước (seq nhỏ nhất ở mỗi thời điểm), rồi app start tại t=0, timer, continuation. Giữa hai điểm chờ là nguyên tử.
2. **Điểm chờ cụ thể:** wait (kể cả 0 ms), wait_until/stable_for khi chưa thoả, ghi có `awaitAck` (ack sau `latency.write`, mặc định 0 ⇒ tiếp tục cùng thời điểm nhưng sau các sự kiện đã xếp), read `fresh`, cuối mỗi vòng repeat/while. Nhánh Parallel bắt đầu ở cùng thời điểm, sau bước hiện tại của run cha.
3. **Ghi actuator đặt target, không đổi giá trị hiện tại** — giá trị hiện tại chỉ đổi khi xe/scenario báo (GW-G: `wait_until` các cửa sổ = 0 thành đúng lúc cảm biến báo 0 tại t=1500, không phải lúc ghi t=1000), đúng mô hình target/current của KUKSA.
4. **Trigger signal:** giá trị có sẵn lúc khởi động là mốc (C08); `any` bắn khi giá trị khác lần trước (lần đầu nhận giá trị cũng tính là thay đổi), `rising/falling/crosses_*` cần giá trị trước; debounce đặt lại timer mỗi thay đổi thoả mode và bắn với giá trị mới nhất (C07). Trigger cùng một sự kiện chạy theo thứ tự id node (C36).
5. **Condition trigger:** đánh giá lại sau mỗi thay đổi signal/biến; bắn ở cạnh false→true (C38); giá trị lúc khởi động là mốc; debounce = phải giữ true đủ lâu.
6. **Timer:** tick đầu tại `initialDelayMs`, chu kỳ cố định; `tick` đếm cả tick bị bỏ (C16: ghi 1 rồi 3).
7. **Concurrency theo trigger:** restart huỷ run đang chạy (trace `cancel` reason `restart`); ignore bỏ; queue FIFO tối đa `queueMax` (tràn ⇒ bỏ cũ nhất + trace `error` reason `queue_overflow`, C12); parallel tối đa `maxRuns` (vượt ⇒ bỏ mới, C14). Một run kết thúc khi mọi fiber của nó (kể cả nhánh `join none`) xong.
8. **Lỗi trong run:** I/O hoặc biểu thức (`no_value`, giá trị ngoài min/max/allowed khi có model, chỉ số mảng ngoài miền) ⇒ trace `error` + output `ok=false/error`; nhánh `error` nối thì đi nhánh đó, không thì `onError` (`continue` ⇒ `next`, `stop` ⇒ dừng run). While vượt `maxIterations` ⇒ trace `error` reason `loop_guard`, dừng run (C29). Stop `workflow` huỷ mọi run khác (C34).
9. **Trace:** mỗi node `enter`/`exit` (`data.handle` = nhánh đi ra), `trigger` (outputs), `write`, `value` (log/MQTT), `error`, `cancel` — hợp lệ contract `trace-event`; sự kiện cấp trigger ngoài run mang `run: 0`. Lịch sử giá trị signal từ scenario trả riêng ở `signals[]` (không phải TraceEvent) cho timeline.
10. **MQTT:** publish của app được giao lại cho trigger khớp topic (`+`/`#`), như broker thật; payload `json` không parse được ⇒ trace `error`, không bắn.

**2026-10-07 — chuẩn bị M6 (runtime C++ phải tái tạo đúng các điểm trên):**
11. **Mỗi waiter chỉ được resume một lần:** khi một run vừa được resume chạy tiếp đồng bộ và đổi state (`state.set`/`state.counter`), lượt `afterChange` lồng nhau có thể đã resume waiter khác; vòng ngoài bỏ qua waiter không còn trong tập chờ. Bản trước resume lần hai ⇒ một `wait` đang chạy của run đó kết thúc sớm (test "waiters are resumed once"). Không golden/conformance nào đổi (`golden-trace: PASS`).
12. **IR của conformance C01–C38** được sinh vào `fixtures/conformance/C*/ir.json` bằng `golden-ir.ts` (cùng cơ chế golden, test so byte trong `compile.test.ts`) để backend chạy P1 (ADR-0042) mà không phụ thuộc compiler.
13. **Ép sang chuỗi theo kiểu tĩnh của giá trị** (`type.cast` → string, `json.string`, ghi signal/state kiểu string): định dạng bằng kiểu tĩnh của biểu thức nguồn như IR_SPEC "Formatting" (float 0.1 ⇒ `"0.1"`); bản trước định dạng như double (`"0.10000000149011612"`), lệch spec. Không golden nào đổi.
14. **Giá trị không tồn tại là lỗi `no_value`** ở mọi nơi: `$ref` tới output `null` (vd. `previous` của giá trị đầu tiên khi chưa có mốc) giống `$signal` chưa có giá trị ⇒ trace `error` + nhánh lỗi, thay vì so sánh ngầm ra `false`/template rỗng (ngữ nghĩa JS không tái tạo được ở backend kiểu tĩnh). Quyết định theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận khi verify cuối.
