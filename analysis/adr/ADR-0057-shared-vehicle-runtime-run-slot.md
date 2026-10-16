# ADR-0057: Runtime xe cho nhiều người dùng — mỗi run có sandbox riêng, giới hạn bằng quota + thời hạn

- **Status:** Proposed (theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận)
- **Date:** 2026-10-15 (sửa cùng ngày sau câu hỏi multi-user của PO, xem Notes)
- **Level:** L1 Subsystem (orchestrator runs, toolchain agent, signal-gateway, studio)
- **Deciders:** PO; Claude Code (đề xuất)
- **Related:** **ADR-0046** (per-run stack & multi-user: pool tĩnh N stack trong Compose, hoãn — ADR này đề xuất thay quyết định 2 của 0046), ADR-0024/0027 (live run, observability), ADR-0052 (databroker theo release, VSS tuỳ biến), ADR-0053 (quota/dung lượng host), AGENTS §2.10 (không mount `docker.sock`), [design M17 §3](../../docs/design/M17-editor-leftovers-and-run-slot.md)

## Context
**Sự cố dẫn tới ADR:** 2026-10-15 PO bấm Run trên `sample-test` và nhận "Another project is running on the vehicle stack". Lúc đó run của `demo-overspeed` (agent bật để PO kiểm tín hiệu) vẫn chạy.

**Hiện trạng (đọc source 2026-10-15):**
- `runs.ts` từ chối mọi run mới khi **bất kỳ** run nào đang hoạt động trên **cả host** (`repo.runs({ active: true, limit: 1 })` ⇒ `RunConflict`).
- Hệ quả: cả bản deploy chỉ một người được Run tại một thời điểm, bất kể user, workspace hay release. **Bản deploy nhiều người dùng không dùng được.**
- Không có thời hạn chạy (chỉ có timeout khởi động 30 s).
- Người bị chặn không biết ai đang chạy, không có cách giải phóng.

**Vì sao trước đây khoá toàn host:**
- Mọi app dùng chung **một databroker cho mỗi release** (`SV_DATABROKERS`).
- Hai app trên một databroker cùng đọc/ghi một bộ tín hiệu VSS ⇒ ghi đè actuator của nhau, trace và Signals lẫn lộn.

**Số đo thật trên máy dev (2026-10-15, `docker stats` / `ps`):**

| Thành phần | RAM |
|---|---|
| KUKSA databroker 0.5.0, mỗi instance | **3,8–5,9 MB**, CPU ~0 % khi rỗi |
| App C++ sinh ra (`demo-overspeed`, đang chạy) | **~14 MB RSS** |
| Signal-gateway (dùng chung) | 48 MB |
| Mosquitto (dùng chung) | 1,2 MB |

Một sandbox (databroker + app) tốn khoảng 20 MB, nên **cô lập từng run là rẻ**.

**Cách app chạy hiện nay:**
- toolchain agent khởi động app dưới dạng **tiến trình** (`Bun.spawn(["setsid", …])`) bên trong container toolchain (không phải container riêng);
- app được truyền `SDV_VEHICLEDATABROKER_ADDRESS`.

Image databroker là một binary duy nhất (distroless). ⇒ Databroker riêng cho mỗi run có thể chạy **dưới dạng tiến trình** cạnh app, **không cần Docker API**, nên không vi phạm luật cấm `docker.sock` (AGENTS §2.10).

## Decision
1. **Mỗi run có sandbox riêng (mặc định):**
   - một tiến trình **KUKSA databroker riêng**, nạp đúng release VSS của app (catalog chuẩn, v4.2 hay mô hình tuỳ biến), cổng cấp phát động;
   - **namespace MQTT riêng**: topic prefix theo app (`settings.mqttTopicPrefix` đã có trong contract project) trên Mosquitto dùng chung;
   - app nhận địa chỉ databroker của sandbox;
   - Run kết thúc (Stop, hết hạn, crash) ⇒ dừng cả app lẫn databroker của nó; không giữ trạng thái giữa các run.
2. **Signal-gateway định tuyến theo run:** Signals, inject, mirror (target→current) và phát scenario dùng địa chỉ databroker của **run đang theo dõi**, không còn bảng `SV_DATABROKERS` cố định. Databroker theo release dùng chung chỉ còn phục vụ Signals khi chưa có run, và các gate cũ.
3. **Giới hạn bằng quota, không bằng khoá:**
   - `SV_MAX_RUNS_PER_USER` (mặc định 2), `SV_MAX_RUNS_TOTAL` (mặc định 20);
   - vượt quota ⇒ 409 `RUN_QUOTA_EXCEEDED` (mã mới) kèm danh sách run đang giữ chỗ **của chính người gọi**;
   - của người khác chỉ báo số lượng, không lộ tên app.
4. **Thời hạn:**
   - `expiresAt = runningAt + SV_RUN_MAX_MINUTES` (mặc định 30; `0` = tắt, chỉ cho máy một người);
   - hết hạn ⇒ dừng như Stop, `stopReason: expired`;
   - **Extend** (`POST /runs/{rid}/extend`) tối đa `SV_RUN_MAX_EXTENSIONS` (mặc định 3);
   - UI cảnh báo 5 phút trước khi hết hạn.
5. **Cùng user bấm Run khi đang có run khác:** không chặn câm.
   - hộp thoại "App *X* đang chạy (12 phút, hết hạn hh:mm)" với **Dừng X và chạy Y** / **Chạy song song** (khi còn quota) / Huỷ;
   - chạy lại **cùng app** đang chạy ⇒ hỏi **Khởi động lại** (Stop + Run bản build mới nhất).
6. **Thấy rõ run đang chạy:**
   - thanh hành động có **"My runs (n)"**: mỗi run có app, release, thời gian, hết hạn, nút Stop;
   - pill trên editor chỉ trạng thái run của app đang mở;
   - trang Vehicle apps đánh dấu app đang chạy;
   - System status có thẻ **Vehicle runtime**: số run/quota toàn host, RAM của các sandbox.
7. **Quản trị:** `scripts/sv runs list|stop <id>`. Run không gắn workspace (gate, script) có owner `system`.
8. **Contracts chỉ thêm:**
   - `Run.expiresAt`, `Run.extensions`, `Run.stopReason` (`user | expired | admin | crashed`);
   - `Run.sandbox` (địa chỉ databroker nội bộ, chỉ trong mạng service);
   - `POST /runs/{rid}/extend`; mã `RUN_QUOTA_EXCEEDED`.

   Không đổi/xoá mã diagnostic cũ.
9. **Chế độ "chung xe" (tuỳ chọn, backlog):** nhiều app chủ động chạy trên cùng một databroker để tương tác (app A ghi, app B đọc). Chỉ bật khi người dùng chọn rõ, nằm ngoài M17.

## Diagram
```mermaid
flowchart LR
  subgraph Run1["Run r1 — user A, app X (v4.0)"]
    DB1[(databroker r1<br/>VSS v4.0)] --- APP1[app X]
  end
  subgraph Run2["Run r2 — user B, app Y (v4.2)"]
    DB2[(databroker r2<br/>VSS v4.2)] --- APP2[app Y]
  end
  subgraph Run3["Run r3 — user A, app Z (v4.0)"]
    DB3[(databroker r3<br/>VSS v4.0)] --- APP3[app Z]
  end
  GW[signal-gateway<br/>route theo run] --> DB1 & DB2 & DB3
  APP1 & APP2 & APP3 --> MQ[(Mosquitto<br/>topic prefix theo app)]
  O[orchestrator<br/>quota user/host + thời hạn] -->|toolchain agent: spawn databroker + app| Run1 & Run2 & Run3
```

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Giữ khoá toàn host (hiện trạng) | Đơn giản | Cả deploy chỉ một người Run | Không dùng được cho nhiều người |
| Một run mỗi databroker dùng chung theo release (bản đầu của ADR này) | Thay đổi nhỏ | Mỗi release vẫn chỉ một người; v4.0 là release mặc định nên gần như vẫn khoá toàn host | Không giải quyết multi-user — thay sau câu hỏi của PO |
| Nhiều run trên cùng databroker dùng chung | Không ai chờ | Ghi đè actuator, trace lẫn lộn | Sai về bản chất (chỉ hợp lệ khi chủ động "chung xe") |
| Pool tĩnh N stack trong Compose (ADR-0046 quyết định 2) | Không cần quyền Docker; cô lập theo network | N cố định, giữ RAM khi rảnh, phải đoán N trước; vẫn chặn khi hết slot | Sandbox dạng tiến trình cũng không cần Docker nhưng co giãn theo nhu cầu, ~20 MB/run |
| Databroker riêng mỗi run dưới dạng **container** (Docker API) | Cô lập mức OS | Orchestrator phải có Docker API ⇒ trái luật `docker.sock`; khởi động chậm hơn | Tiến trình đủ cô lập ở mức cổng/bộ nhớ, rẻ, không cần Docker |
| Hàng đợi run | Công bằng | Phải chờ mà không biết bao lâu | Sandbox + quota cho phép chạy ngay |

## Consequences
- **Tích cực:**
  - nhiều người, nhiều app chạy song song, kể cả cùng release;
  - mỗi run sạch, không bị trạng thái tín hiệu của run trước ảnh hưởng;
  - người dùng thấy và quản lý được run của mình;
  - không còn run bị quên giữ chỗ.
- **Tiêu cực / rủi ro:**
  - toolchain image (hoặc một image runtime riêng) phải chứa binary databroker (Apache-2.0, ghi NOTICE);
  - signal-gateway phải định tuyến động;
  - mỗi run trên một release tuỳ biến phải nạp đúng file VSS từ vss-catalog;
  - tài nguyên tăng tuyến tính theo số run (~20 MB + CPU khi build không đổi), nên quota là bắt buộc;
  - gate parity/live dùng databroker cố định phải chuyển sang sandbox hoặc giữ chế độ cũ có kiểm soát.
- **Ảnh hưởng tới module:**
  - contracts (additive);
  - orchestrator: runs, quota, thời hạn, cấp cổng;
  - velocitas-stack: toolchain agent spawn databroker, image có binary;
  - signal-gateway: route theo run;
  - studio: "My runs", hộp thoại cùng user, System status;
  - scripts: `sv runs`;
  - gate; AI tool `run`.

## Implementation
| Task | Module | Milestone |
|---|---|---|
| **Spike:** chạy databroker dạng tiến trình trong toolchain (binary từ image kuksa 0.5.0), đo thời gian khởi động/RAM, nạp VSS tuỳ biến, 5 run song song cùng release | velocitas-stack | M17-T04a |
| Contracts + orchestrator: sandbox mỗi run, quota user/host, thời hạn, extend, `stopReason`, `RUN_QUOTA_EXCEEDED` | contracts, orchestrator, velocitas-stack | M17-T04 |
| Signal-gateway định tuyến theo run; Studio "My runs", hộp thoại cùng user, cảnh báo hết hạn, thẻ Vehicle runtime; `scripts/sv runs`; gate | signal-gateway, studio, scripts, gate | M17-T05 |

## Verification
- **Spike:** 5 run song song cùng v4.0, inject vào run 1 không làm đổi tín hiệu run 2; số đo khởi động và RAM ghi vào ADR Notes.
- **Unit orchestrator:**
  - quota user/host;
  - hết hạn (đồng hồ giả); extend tới giới hạn;
  - stop người khác ⇒ 403;
  - restart orchestrator giữ hạn và dọn sandbox mồ côi.
- **Gate trên stack:** hai user cùng v4.0 chạy song song, mỗi người inject và nhận đúng output của mình; hết hạn tự dừng; quota chặn đúng.
- **E2E:**
  - cùng user Run app thứ hai ⇒ hộp thoại dừng/chạy song song;
  - "My runs" hiện đủ, Stop được.
- **Full luồng `@live` + README** (AGENTS §4 bước 7).

## Notes / Deviations
- 2026-10-16 — **M17-T04 implement** (orchestrator, toolchain agent, contracts):
  - Bật bằng `SV_RUN_SANDBOX=1`, mặc định `0` (giữ hành vi một run) cho tới khi M17-T05 định tuyến signal-gateway theo run.
  - Databroker của sandbox bind `0.0.0.0:<cổng>` trong container toolchain. App dùng `127.0.0.1:<cổng>`. Signal-gateway (T05) dùng `Run.sandbox` = `toolchain-<lang>:<cổng>` trên `sv-internal`. Như vậy câu hỏi số 3 của spike được trả lời: không cần route qua agent.
  - **Lệch so với checklist phase:**
    - Restart orchestrator vẫn **dừng** mọi run còn active (`recover()` như M08), không giữ hạn của run còn sống. Agent dừng job ⇒ databroker của sandbox cũng dừng, nên không còn sandbox mồ côi.
    - Giữ run qua restart cần theo dõi lại job đang chạy (follow từ seq cuối) — ghi nợ, chờ PO xác nhận nếu cần.
  - **Quyền Stop/Extend:** BFF yêu cầu quyền write trên workspace của app (`authorizeProject`). Run của app khác ⇒ 404. Không thêm kiểm "chỉ chủ run", vì người cùng workspace có quyền write được phép theo phase.
  - **Chưa kiểm:** VSS tuỳ biến trên sandbox và image toolchain có binary databroker. Image build ở CI; kiểm cùng gate T05/T07.
- 2026-10-16 — **Spike M17-T04a PASS** trên stack dev (toolchain-cpp, không đổi image):
  - Binary `/app/databroker` của `ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0` (7,2 MB, ELF amd64) chạy được dạng tiến trình trong container toolchain.
    - Cờ dùng: `--insecure --enable-databroker-v1 --address 127.0.0.1 --port <p> --worker-threads 2 --vss <file>`.
  - **5 instance song song cùng VSS 4.0:** sẵn sàng sau 12–26 ms mỗi instance, RAM ~7 MB mỗi instance (`--worker-threads 2`).
    - Ghi `Vehicle.Speed` vào instance 1 (130) và 3 (42), các instance khác vẫn `None` ⇒ **không lẫn tín hiệu**.
  - **2 app `demo-overspeed` thật song song** (~13 MB mỗi app), mỗi app trỏ `SDV_VEHICLEDATABROKER_ADDRESS` vào databroker riêng.
    - Inject 100 → 130 vào sandbox 1 ⇒ sau 2 s `Hazard.IsSignaling` target = `true` chỉ ở sandbox 1; sandbox 2 `None`.
    - App 1 có 18 sự kiện trace, app 2 chỉ có 2 (khởi động).
  - **Phát hiện cho phần code:**
    1. Tiến trình databroker phải do **toolchain agent spawn và thu dọn**. Ở spike, tiến trình mồ côi thành zombie vì PID 1 của container không reap. Lưu ý: dừng app không được dùng `pkill -f` (khớp nhầm shell).
    2. Image toolchain chép binary bằng multi-stage `COPY --from` và phải kèm `app/thirdparty-licenses/` + `sbom.json` của image KUKSA vào NOTICE.
    3. Cấp cổng trong `127.0.0.1` của container toolchain là đủ: app và databroker cùng container; signal-gateway cần route qua agent hoặc bind theo cách khác — quyết định ở T05.
  - **VSS tuỳ biến:** chưa thử trong spike (chỉ VSS 4.0). Ghi vào M17-T04 checklist để kiểm cùng lúc làm code.
- 2026-10-15 — bản đầu của ADR này (cùng ngày) chọn "một run mỗi databroker dùng chung + thời hạn". Lý do loại phương án databroker riêng mỗi run lúc đó là "tốn RAM/CPU", **chưa đo**.
- 2026-10-15 (đối chiếu sau): ADR-0046 đã có trước, chọn "pool stack tĩnh" khi cần multi-user (hoãn chờ PO). Bản đầu của ADR này chưa nhắc tới 0046; nay ghi rõ: ADR-0057 đề xuất **thay quyết định 2 của ADR-0046** bằng sandbox dạng tiến trình (cùng nguyên tắc không docker.sock), và ADR-0046 có Notes trỏ sang đây. Khi PO duyệt, 0046 chuyển "Superseded (một phần) by ADR-0057".
- Sau câu hỏi của PO về multi-user, đã đo lại: databroker 3,8–5,9 MB, app ~14 MB. Lý do loại đó sai, và phương án cũ không cho nhiều người dùng chạy (mỗi release một người). Decision đổi sang sandbox mỗi run; phương án cũ chuyển xuống Alternatives.
