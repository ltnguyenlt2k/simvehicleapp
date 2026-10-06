# Review expected writes/trace GW-A…GW-G (M05-T11)

> Review do agent thực hiện theo **uỷ quyền PO 2026-10-06**, chờ PO xác nhận. Kết quả đóng băng là chuẩn parity cho runtime C++/Python (M6+, ADR-0042).

- Nguồn: `fixtures/golden/GW-*/expected.{writes,trace}.json`, sinh bằng `bun packages/simulator/src/golden-trace.ts --write` (core) từ `ir.json` + `scenario.yaml`, `runId = "golden"`; test so byte; mọi event hợp lệ `trace-event`.
- `expected.writes` của cả 7 golden bằng đúng `expect.writes` viết tay trong scenario (test conformance golden PASS) — writes không phải "chụp lại" mà được đối chiếu với kỳ vọng suy tay.

| Golden | Điểm đã kiểm trên trace | KQ |
|---|---|---|
| GW-A | run 1 (Speed 100) `broken` ngay; run 2 (130) huỷ `restart` lúc 3000; run 3 (135) `stable` lúc 5000 ⇒ ghi Hazard true + publish HMI; lúc 6000 hai trigger theo thứ tự id: run 4 `broken`, run 5 ghi false | ✔ |
| GW-B | SoC 25 ⇒ else; SoC 15 ∧ moving ⇒ then ⇒ HMI + Color "RED" lúc 2000; sau khi dừng xe (3000) SoC 10 ⇒ else | ✔ |
| GW-C | debounce 500 ms (trigger bắn 500 ms sau thay đổi cuối: 1700, 3500, 5500); Expression inline ⇒ 3 ghi Wiping.Mode INTERVAL / FAST / OFF theo ngưỡng | ✔ |
| GW-D | `crosses_above 15` bắn hai lần (2000: 10→20; 5000: 5→25 sau khi xuống dưới 15), mỗi lần 4 ghi khoá cửa nối tiếp cùng thời điểm (ghi có ack ⇒ nhường lượt) | ✔ |
| GW-E | tick 1000/2000/3000 ⇒ 3 publish telemetry JSON hợp lệ (`speed` float định dạng ngắn nhất) | ✔ |
| GW-F | app start ⇒ parallel: nhánh n3 (ghi đèn, nhường lượt) và n4 (wait 500) xen kẽ trên một strand; join all ⇒ log lúc 500 | ✔ |
| GW-G | condition (mưa > 30 ∧ dừng) lúc 1000 ⇒ 4 ghi cửa sổ; `wait_until` đúng lúc cảm biến báo 0 (1500), không phải lúc ghi (target ≠ current) ⇒ log "windows closed" | ✔ |

Quy ước trace (ADR-0017 Notes §9): `cancel` gắn node trigger của run bị huỷ; ghi có ack: `enter → write → (nhường lượt) → exit`.
