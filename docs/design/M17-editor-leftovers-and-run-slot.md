# M17 — Dọn bề mặt Sim còn sót trong editor + chia sẻ runtime xe

> PO 2026-10-15, kèm 4 ảnh chụp: khung **Chat**, menu **"…"** của editor, trợ lý đang "Working…", và lỗi **"Run: Another project is running on the vehicle stack"**.
> Tài liệu này **chỉ phân tích và ra quyết định**; code làm ở M17 theo [phase](../../analysis/phases/M17-editor-leftovers-and-run-slot.md).
> ADR: [0056](../../analysis/adr/ADR-0056-sim-execution-surfaces-and-workflow-menu.md), [0057](../../analysis/adr/ADR-0057-shared-vehicle-runtime-run-slot.md) — Proposed.

## 1. Khung "Chat" (ảnh 1)

**Nó là gì (đọc từ source `components/chat/chat.tsx`, 1.191 dòng, nguyên của Sim):**
- Cách mở: nút bong bóng cạnh menu "…" (`panel.tsx`), mục "Open Chat" ở menu chuột phải của canvas, và một phím tắt trong `workflow.tsx`.
- Khung này là **chat thử workflow của Sim**: tin nhắn trở thành input của block Start/Chat trigger, rồi workflow chạy bằng **executor của Sim** (`useWorkflowExecution`). Ô "Outputs" chọn output của block nào được in ra làm câu trả lời; có đính kèm file.

**Có phù hợp không — không:**
- Workflow xe không có Start/Chat trigger; trigger là tín hiệu VSS, timer, MQTT.
- Executor của Sim không biết block `sv_*`. Mọi block lạ rơi vào `GenericBlockHandler` (`canHandle` luôn `true`), nên kết quả **sai nghĩa** so với IR, simulator và app thật. Đây là con đường thứ ba chạy cùng một workflow, trái nguyên tắc "một IR, hai cách chạy" (simulator + binary Velocitas, ADR-0017/0020).
- Người dùng dễ nhầm với **Assistant** (trợ lý AI). Assistant mới là chat có nghĩa trong SimVehicleApp: đề xuất WorkflowPatch.
- Mọi việc nó có thể làm đều đã có chỗ đúng: thử logic → **Simulate**; chạy thật và đưa tín hiệu vào → **Run** + tab **Signals**; hỏi bằng lời → **Assistant**.
- M11-T03 đã gỡ Deploy và Run của Sim nhưng bỏ sót khung Chat cùng họ với chúng.

**Quyết định:** ẩn khung Chat và mọi đường vào nó (nút trên panel, "Open Chat"/"Close Chat" ở menu canvas, phím tắt). Chỉ ẩn bằng cấu hình như M16-T07, không xoá file Sim (ADR-0008). Route `api/workflows/[id]/chat` cũng bị chặn ở BFF.

**Cùng họ, cùng quyết định:** "Run from block" / "Run until block" trong menu block và thanh nút trên block cũng chạy executor của Sim ⇒ ẩn. Muốn "chạy từ đây" cho workflow xe thì cách đúng là Simulate với scenario; ghi vào backlog: *Simulate từ một block*.

## 2. Menu "…" của editor (ảnh 2)

| Mục | Làm gì (theo source) | Đánh giá | Quyết định |
|---|---|---|---|
| **Auto layout** | Xếp lại vị trí block (`api/workflows/[id]/autolayout`) | Có ích, nhất là sau khi Accept đề xuất của trợ lý hoặc import `graph.json` (không có toạ độ). Không đụng ngữ nghĩa | **Giữ** |
| **Variables** | Bảng biến của workflow | **Bắt buộc**: block Get/Set variable chọn biến từ đây (M03-T09); adapter đưa biến vào WorkflowGraph | **Giữ** |
| **Lock / Unlock workflow** | Khoá mọi block (không sửa/xoá); bị vô hiệu khi workflow đã khoá ở mức folder/row | Hữu ích khi nhiều người cùng sửa, hoặc để giữ bản đã chạy thật | **Giữ** |
| **Export workflow** | Tải **JSON nội bộ của Sim** (block, toạ độ, biến) để import lại qua thanh bên | Hữu ích (sao lưu, chuyển workspace) nhưng có **lỗi dữ liệu**: không kèm **release VSS** và **scenario** (lưu ở bảng riêng `sv_workflow_settings`, `sv_workflow_scenarios`). Import lại thì workflow v4.2 rơi về release mặc định (path có thể không tồn tại) và mất scenario (= mất test sinh ra). Tên còn dễ nhầm với nút **Export** trên thanh hành động (zip app build được) | **Giữ, sửa:** đổi tên "Download workflow (.json)"; nhúng phần mở rộng `simvehicleapp: { vssRelease, scenario }` khi tải và khôi phục khi import |
| **Duplicate workflow** | Nhân bản workflow (`api/workflows/[id]/duplicate`) | Có ích, nhưng cùng lỗi: bản sao **không copy** release VSS và scenario (đã kiểm: route không đụng bảng `sv_*`) | **Giữ, sửa:** copy kèm release và scenario |
| **Delete workflow** | Xoá mềm (khôi phục được ở Settings → Recently deleted) | Cần. M16 đã xử lý app chứa workflow bị xoá (SynCode bỏ qua; app không còn workflow ⇒ "Unused") | **Giữ** |

**Nhất quán với thanh hành động:** menu "…" là thao tác trên **workflow** (bản thiết kế), thanh hành động là thao tác trên **vehicle app** (code, build, chạy, zip). Tên mục phải tách rõ hai thứ này, vì thế đổi "Export workflow" thành "Download workflow (.json)".

## 3. Lỗi "Run: Another project is running on the vehicle stack" (ảnh 4)

**Nguyên nhân lần này:**
- App `demo-overspeed` do agent bật cho PO kiểm tín hiệu (2026-10-15) vẫn đang chạy.
- Orchestrator chỉ cho **một run trên toàn host** (`runs.ts`: `repo.runs({ active: true, limit: 1 })` ⇒ `RunConflict`). App `sample-test` vì thế bị từ chối 409, BFF đổi thành câu trên.
- Thông báo đúng sự thật, nhưng lộ ra 4 vấn đề thật của sản phẩm.

| # | Vấn đề | Hậu quả |
|---|---|---|
| R1 | Khoá **toàn host**, trong khi mỗi release VSS có databroker riêng (v4.0, v4.2, tuỳ biến) | Người dùng v4.2 bị chặn bởi một app v4.0 dù hai bên không dùng chung tín hiệu |
| R2 | **Không giới hạn thời gian** chạy (chỉ có timeout lúc khởi động 30 s) | Một run bị quên giữ chỗ mãi mãi; host nhiều người dùng sẽ kẹt |
| R3 | Người bị chặn **không biết** app nào, của ai, từ lúc nào, và không có cách giải phóng | Phải hỏi quản trị viên; quản trị viên cũng không có nút dừng (chỉ có API nội bộ) |
| R4 | Thông báo hiện kiểu toast chung, nút Run vẫn bật | Người dùng bấm lại nhiều lần, không có hướng dẫn |

**Phạm vi khoá hiện nay — toàn host, không phải theo user** (PO hỏi lại 2026-10-15):
- Cả bản deploy chỉ **một** app được Run tại một thời điểm, bất kể user, workspace hay release.
- Lý do gốc: mọi app dùng chung một databroker cho mỗi release. Hai app trên một databroker ghi đè tín hiệu của nhau, trace và Signals lẫn lộn.
- Đúng cho giai đoạn một người dùng, **không dùng được khi deploy nhiều người**.

**Số đo thật (2026-10-15):**
- KUKSA databroker: **3,8–5,9 MB** RAM mỗi instance, CPU ~0 % khi rỗi;
- app C++ đang chạy: **~14 MB**.

⇒ Cô lập từng run rất rẻ (~20 MB/run).

**Cách app chạy:** tiến trình do toolchain agent spawn trong container toolchain. Image databroker là một binary duy nhất. ⇒ Databroker riêng cho mỗi run chạy được **dạng tiến trình**, không cần Docker API, giữ luật không mount `docker.sock`.

**Quyết định (ADR-0057, sửa cùng ngày — bản đầu "một run mỗi databroker dùng chung" bị thay vì không giải quyết multi-user):**
1. **Sandbox mỗi run:** databroker riêng (đúng release VSS của app, kể cả mô hình tuỳ biến) + namespace MQTT riêng (topic prefix theo app). Run kết thúc ⇒ dọn cả sandbox.
2. **Signal-gateway định tuyến theo run:** Signals, inject, mirror và phát scenario dùng databroker của run đang theo dõi.
3. **Quota thay khoá:**
   - `SV_MAX_RUNS_PER_USER` (2), `SV_MAX_RUNS_TOTAL` (20);
   - vượt quota ⇒ `RUN_QUOTA_EXCEEDED`, liệt kê run của chính người gọi; của người khác chỉ đếm số.
4. **Thời hạn:** `SV_RUN_MAX_MINUTES` (30), Extend tối đa 3 lần, cảnh báo trước 5 phút, `stopReason: expired`.
5. **Cùng user Run app khác khi đang có run:**
   - hộp thoại **Dừng X và chạy Y / Chạy song song** (khi còn quota) / Huỷ;
   - Run lại cùng app đang chạy ⇒ hỏi **Khởi động lại**.
6. **Thấy rõ run:**
   - thanh hành động có "My runs (n)" (app, release, thời gian, hết hạn, Stop);
   - Vehicle apps đánh dấu app đang chạy;
   - System status có thẻ **Vehicle runtime**.
7. **Quản trị:** `scripts/sv runs list|stop`.
8. **Chế độ "chung xe"** (nhiều app tương tác trên một databroker): tuỳ chọn, backlog.
9. **Spike trước khi code (T04a):** databroker dạng tiến trình trong toolchain; đo khởi động/RAM; 5 run song song cùng release không lẫn tín hiệu; nạp VSS tuỳ biến.

## 4. Trợ lý "Working…" (ảnh 3) và hiệu ứng "đang suy nghĩ"

**Không phải lỗi:** endpoint `openai-compatible · local-agent` của PO trả lời chậm (đã đo ở M10, đôi khi 524); kết quả (workflow LKA, ảnh 4) hợp lệ.

**Vấn đề UX:** trong lúc chờ chỉ có dòng chữ tĩnh "Working…" (`assistant-panel.tsx`). Người dùng không biết trợ lý còn sống, đang làm gì hay đã chờ bao lâu, và không có cách dừng.

**PO yêu cầu (2026-10-15):** có hiệu ứng để người dùng cảm nhận AI đang suy nghĩ.

**Dữ kiện:** stream của trợ lý (`lib/api/contracts/sv-ai.ts`) đã phát các sự kiện:
- `tool` (tên công cụ đang gọi);
- `tool_result`;
- `text` (từng đoạn chữ);
- `proposal`, `pending_action`, `done`.

⇒ Hiển thị được **bước thật** đang làm, không cần chữ giả.

**Quyết định (M17-T06, ADR-0054 §UI — không cần ADR mới):**
1. **Hiệu ứng "đang suy nghĩ":**
   - biểu tượng trợ lý có vòng sáng nhấp nháy nhẹ, kèm 3 chấm chạy;
   - chữ **"Thinking…"** có hiệu ứng ánh sáng chạy qua (shimmer), dùng token màu sẵn có.
   - Tắt animation khi người dùng bật `prefers-reduced-motion`; khi đó chỉ còn chấm tĩnh và chữ.
2. **Bước đang làm theo sự kiện thật:**
   - mỗi sự kiện `tool` thêm một dòng với nhãn dễ hiểu, ánh xạ theo tên tool: "Đang tìm tín hiệu VSS…", "Đang đọc workflow…", "Đang kiểm tra (lint)…", "Đang chạy mô phỏng…", "Đang soạn đề xuất…";
   - dòng đang chạy có spinner; nhận `tool_result` thì đổi thành ✓ (lỗi thì ✕);
   - tool chưa có nhãn ⇒ hiện tên tool.
3. **Chữ trả lời hiện dần** theo `text` delta, có con trỏ nhấp nháy ở cuối trong lúc stream.
4. **Thời gian đã chờ** ("12 s"). Sau 30 s thêm gợi ý "Model đang trả lời chậm" kèm tên provider/model.
5. **Nút Stop:** huỷ lượt đang chạy (abort request; server bỏ kết quả, không áp đề xuất dở dang).
6. **Không hiện chuỗi suy nghĩ nội bộ của model** (không có trong contract, và dễ gây hiểu nhầm). Chỉ hiện các bước công cụ thật và câu trả lời.

## 5. Kiểm thử

| Khía cạnh | Kiểm thử |
|---|---|
| Ẩn Chat / Run from block | Unit: danh sách bề mặt ẩn; E2E: không có nút Chat, menu canvas không có "Open Chat", menu block không có "Run from/until block"; route chat của workflow trả 404 |
| Download/Duplicate giữ dữ liệu xe | Unit: JSON tải về có `simvehicleapp.vssRelease` + scenario; import khôi phục; duplicate copy cả hai. E2E: workflow v4.2 có scenario ⇒ duplicate ⇒ bản sao vẫn v4.2, Simulate ra cùng kết quả |
| Gate | Gate run mới: hai user cùng release song song; hết hạn tự dừng (`SV_RUN_MAX_MINUTES` nhỏ); quota |
| Trợ lý đang suy nghĩ | Vitest: ánh xạ tên tool → nhãn; danh sách bước ✓/✕ theo `tool`/`tool_result`; reduced-motion tắt animation; Stop huỷ request. E2E với fake provider có độ trễ: thấy "Thinking…", bước, thời gian, Stop |
| Runtime nhiều người dùng | Spike: 5 run song song cùng v4.0 không lẫn tín hiệu; unit quota/hạn/extend; gate hai user cùng release; E2E "My runs" + hộp thoại cùng user |
| Quy tắc AGENTS §4 bước 7 | Full luồng `@live`, quay lại video nếu UI đổi, cập nhật README |
