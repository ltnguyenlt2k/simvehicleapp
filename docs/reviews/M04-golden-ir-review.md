# Review golden IR GW-A…GW-G (gate M4, lần đầu)

> Review do agent thực hiện theo **uỷ quyền PO 2026-10-06**, chờ PO xác nhận khi verify cuối. Gate M4 yêu cầu "Golden IR GW-A..G khớp snapshot (review thủ công lần đầu)".

- Nguồn: `modules/simvehicleapp-contracts/fixtures/golden/GW-*/ir.json`, sinh bằng `bun packages/compiler/src/golden-ir.ts --write` (core) từ `graph.json` + VSS fixture; test `compile.test.ts` so khớp byte, chạy hai lần ra cùng byte, validate schema `ir.v1`.
- Cách review: đối chiếu từng IR với `graph.json`, BlockSpec/semantics và ADR-0012/0014/0015 (Notes 2026-10-06).

| Golden | Điểm đã kiểm | KQ |
|---|---|---|
| GW-A | 2 trigger `signal_changed` dùng chung `s1` (Speed float km/h); n5 `crosses_below`, threshold `110` gán kiểu float km/h; n2 `stable_for` 2000 ms, điều kiện `n1.value > 120` (literal nhận km/h); `stable` → n3 ghi Hazard `true` (awaitAck, onError continue) → n4 HMI ⇒ `mqtt_publish` topic `simvehicleapp/stable-overspeed-warning/hmi`, payload JSON có `json.string` + `ts = now_ms()`; `broken` = null; signals theo path, access write/subscribe | ✔ |
| GW-B | `if` then → HMI → ghi `Color` = `"RED"` (string const); điều kiện `<socchanged.value> < 20 && <Vehicle.IsMoving>` (`$ref` + `$signal`) | ✔ |
| GW-C | Block Expression "Wiper mode" chỉ dùng `$ref` ⇒ **inline** vào giá trị ghi `Wiping.Mode` (ternary chuỗi); debounce 500 ms | ✔ |
| GW-D | `crosses_above 15`, concurrency `ignore`; 4 ghi khoá cửa nối tiếp | ✔ |
| GW-E | `timer` 1000/1000 ms concurrency `ignore` (mặc định tường minh); `mqtt_publish` payload template JSON với `$signal` | ✔ |
| GW-F | `app_start` (không concurrency) → `parallel` join all, `branches` [n3, n4] (theo blockId), `next` → n6 log; n4 wait 500 → n5 ghi `80` kiểu `uint8 %` | ✔ |
| GW-G | `event.condition` (`$signal` rain/speed, literal nhận unit) concurrency `ignore`; 4 ghi `0` `uint8 %`; `wait_until` ok → log info, timeout → log warn | ✔ |

Không phát hiện sai lệch. Các quy ước kiểm ở đây đã ghi trong ADR-0014 Notes §1–§11.
