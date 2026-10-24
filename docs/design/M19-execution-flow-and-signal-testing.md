# Thiết kế M19 — Luồng thực thi (Flow) và thử tín hiệu chỉn chu

> Yêu cầu PO 2026-10-24. Quyết định: [ADR-0062](../../analysis/adr/ADR-0062-execution-flow-trace-and-signal-testing.md). Kế hoạch: [phase M19](../../analysis/phases/M19-execution-flow-and-signal-testing.md).
> Trạng thái: đề xuất, chờ PO xác nhận.

## 1. Yêu cầu
"Các chỗ dùng simulate tín hiệu, test workflow … làm chỉn chu lại, **log tracking show luồng**. Phần đã có thì làm chuẩn chỉnh, chính xác hơn; phần chưa có thì thêm mới."

Hiểu yêu cầu thành ba câu hỏi người dùng phải trả lời được ở **mọi** nơi chạy workflow (Simulate, Test, Live):
1. App đã làm gì, theo thứ tự nào? (luồng)
2. Vì sao app đi nhánh này, hoặc không làm việc mình chờ? (lý do)
3. Giá trị này từ đâu ra: tôi inject, playback của test case, chính app ghi, hay xe? (nguồn)

## 2. Kiểm kê hiện trạng (source ngày 2026-10-24)

### 2.1 Nơi tạo tín hiệu thử
| # | Nơi | File | Cách tạo tín hiệu | Kết quả hiển thị |
|---|---|---|---|---|
| 1 | Simulate | `components/sv/sim/simulation-timeline.tsx`, core `packages/simulator` | scenario (initial + inputs theo `t`) trên đồng hồ ảo | timeline + badge trên block (`trace-badge.tsx`) |
| 2 | Tab Test: Simulate case | `components/sv/sim/test-tab.tsx`, `lib/sv/expectations.ts` | test case (scenario 1.1) | pass/fail + `problems` |
| 3 | Tab Test: Generate tests | `lib/sv/test-generate.ts` | giá trị biên của mỗi phép so sánh, Stable/broken | case mới, độ phủ nhánh |
| 4 | Tab Test: Play on vehicle | gateway `POST /play` + `observe` | phát scenario lên databroker thật | chấm điểm theo `observed` (300 ms) |
| 5 | Tab Live: Signals | `components/sv/run/signals-panel.tsx`, `signals-model.ts` | inject từng giá trị (ô nhập theo kiểu catalog) | giá trị hiện tại trong bảng Signals |
| 6 | Tab Live: Record | `signals-panel.tsx` (`recordingToScenario`) | ghi inject + thay đổi actuator | test case mới |
| 7 | Tab Live: Messages | `components/sv/run/messages-panel.tsx`, gateway `GET /messages` | (chỉ quan sát MQTT/HMI) | thẻ HMI, tin MQTT |
| 8 | Trợ lý | ai `scenario_propose` / `scenario_run` (M18-T06) | case do trợ lý đề xuất | thẻ đề xuất, pass/fail |

### 2.2 Nơi hiển thị luồng
| Nơi | Hiện được | Chưa đúng / còn thiếu |
|---|---|---|
| Timeline Simulate | sự kiện theo thời gian ảo, con trỏ tua | không gom theo lần chạy; không lý do nhánh; khác format với console |
| Run console | log + trace, lọc, 5 000 dòng | trace là JSON thô; phẳng; không có input inject; không tên nhánh |
| Badge block | trạng thái/giá trị của block ở con trỏ hoặc live | chỉ một block một lúc, không thấy chuỗi |
| Kết quả Test | `problems` dạng chữ | không chỉ chỗ luồng lệch; không xem được luồng của case |

### 2.3 Dữ liệu trace hiện có
- `trace-event.v1`:
  - `trigger` (`data.outputs`), `enter`, `exit` (`data.handle` khi block rẽ nhánh), `value` (`kind: log | mqtt`), `write` (`path`, `value`), `error` (`reason`), `cancel`;
  - `run` = số lần chạy trong app;
  - sự kiện hệ thống `app.*`, `vdb.*`.
- `signal-update.v1`: `path, ts, value, field`. **Không có nguồn.**
- Golden `expected.trace.json` GW-A…G là trace đóng băng của simulator, runtime phải tái lập (ADR-0042). Đây là bộ dữ liệu kiểm cho mô hình Flow.

## 3. Thiết kế

### 3.1 Mô hình `FlowRun` (`lib/sv/flow-trace.ts`)
```ts
interface FlowRun {
  key: string                // `${wf}:${run}`
  wf: string; run: number
  trigger: { blockId: string; node: string; ts: number; outputs: Record<string, unknown> }
  cause?: { kind: 'signal' | 'mqtt' | 'timer' | 'start'; path?: string; topic?: string; value?: unknown; source?: SignalSource; ts: number }
  steps: FlowStep[]          // in order of `enter`
  writes: { ts: number; path: string; value: unknown; blockId: string }[]
  outcome: 'running' | 'done' | 'cancelled' | 'error'
  startedAt: number; endedAt?: number
}
interface FlowStep {
  blockId: string; node: string
  enteredAt: number; exitedAt?: number      // duration = exitedAt - enteredAt (time waited by Stable for / Wait until included)
  handle?: string                            // then | else | stable | broken | ok | timeout | case-n | default
  eval?: { refs: Record<string, unknown>; result: unknown }
  values: { kind: 'log' | 'mqtt'; text: string }[]
  error?: { reason: string; message?: string }
}
```
- Thuần, tất định, không phụ thuộc React. Input: danh sách `TraceEvent` theo `seq`, cùng signal updates (để tìm `cause`).
- `cause`: signal update gần nhất của path trigger, có `ts ≤ trigger.ts` và cách tối đa 1 s. Nếu không tìm được thì lấy `trigger.outputs` (có giá trị trigger đọc).

### 3.2 Lý do rẽ nhánh (`data.eval`)
- `exit` của `sv_if` / `sv_switch` / `sv_stable_for` / `sv_wait_until` và trigger `crosses_*` / `rising` / `falling` mang:
  ```json
  {"handle":"then","eval":{"refs":{"<Vehicle.Speed>":121},"result":true}}
  ```
- `refs` là giá trị **lúc đánh giá** của mọi `$ref` / path trong biểu thức (tối đa 8, theo thứ tự xuất hiện).
- Runtime đã có giá trị khi đánh giá biểu thức, nên phát thêm không tốn truy vấn mới.
- Conformance: mỗi case C01–C45 có trace kỳ vọng. Thêm `eval` vào trace kỳ vọng của các case có quyết định; cả 3 runtime phải khớp.

### 3.3 Nguồn tín hiệu (`signal-update.source`)
| source | Khi nào | Gateway biết bằng cách |
|---|---|---|
| `inject` | người dùng bấm Set/Send ở Signals | chính request `POST /signals` |
| `playback` | Play test case / Record replay | player đang chạy, giá trị nằm trong cửa sổ ±250 ms của bước |
| `mirror` | gateway làm provider phản chiếu (ADR-0047) | giá trị do `Mirror` publish |
| `app` | app ghi actuator (target) | thay đổi target không do gateway đặt |
| `vehicle` | provider khác (xe thật, mock provider) | còn lại |

### 3.4 Flow view
```
Live ▸ [Run console] [Messages] [Flow]                    ⏸ Follow   Filter: All triggers ▾  ⤓ JSONL
─────────────────────────────────────────────────────────────────────────────────────────────────
▾ #12  12:01:03.120  Speed changed            ✓ done · 6 ms
    ↳ Speed = 121 km/h                         (you injected)
    ① If Speed > 120 ................ then     121 > 120
    ② Set Hazard = true ............. ✓ write  4 ms
▸ #11  12:00:58.004  Speed changed            ✓ done · else (95 > 120 is false)
▸ #10  12:00:41.900  App starts               ✓ done
```
- Một dòng tóm tắt mỗi lần chạy; mở ra là các bước. Nhãn block dùng câu tóm tắt có sẵn (M16-T08); giá trị có đơn vị từ catalog.
- Bấm bước ⇒ `canvas-highlight` chọn và căn giữa block. Bấm write ⇒ mở signal đó trong Signals.
- Simulate: Flow nằm cạnh timeline. Bấm một lần chạy thì con trỏ tua nhảy tới `startedAt`.
- Test: mỗi case mở ra Flow của chính case đó.

### 3.5 Run console
- Dòng trace hiện dạng câu, ví dụ `Speed changed → If Speed > 120: then (121 > 120)`, thay cho JSON.
- Nút "Raw" để xem nguyên bản.
- Input inject/playback hiện thành dòng `↳ input Speed = 121 km/h (you)`.

### 3.6 Giải thích case FAIL và tạo case từ một lần chạy
- Với mỗi kỳ vọng không đạt (`write` thiếu/sai giá trị/trễ, `never` bị vi phạm, publish thiếu): lấy lần chạy có `trigger.ts` gần `t` mong đợi nhất. Hiện nhánh thực tế, giá trị `eval`, và nhánh cần để có write đó. Nhánh cần tìm bằng duyệt ngược graph từ block Set của path.
- "Make test case from this run": initial = giá trị các signal workflow đọc ngay trước `cause.ts`; input = `cause`; expectations = writes (+ `never` cho actuator không ghi), `within` 300 ms. Ghi thành case mới qua BFF có sẵn.

### 3.7 Hiệu năng và giới hạn
- 5 000 sự kiện ⇒ ≤ 50 ms (vitest benchmark đơn giản).
- Flow chỉ giữ 200 lần chạy gần nhất; cũ hơn thì hiện "N lần chạy cũ đã ẩn".
- Sampling của ADR-0027 §5 (`data.dropped`): Flow ghi "đã gộp N sự kiện" ở bước tương ứng, không đoán bước thiếu.

## 4. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Trace level `node` tốn băng thông khi tần suất cao | `eval` chỉ ở block quyết định; sampling sẵn có; giới hạn 8 ref |
| Ba runtime phát `eval` lệch nhau | conformance so `eval`; parity P3 live |
| Gắn nguồn sai khi app và người dùng ghi cùng path gần nhau | cửa sổ ±250 ms như Play (đã dùng ở M18-T04); test riêng |
| Người dùng nhầm Flow (một lần chạy) với timeline (thời gian) | Flow và timeline liên kết hai chiều (bấm là nhảy) |

## 5. Ngoài phạm vi
- Lưu Flow phía server cho run dài hơn 5 000 sự kiện.
- OpenTelemetry.
- So sánh hai lần chạy.
