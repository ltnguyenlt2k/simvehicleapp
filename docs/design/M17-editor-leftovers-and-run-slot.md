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

**Vì sao không cho nhiều run trên cùng databroker:** hai app cùng đọc/ghi một bộ tín hiệu VSS sẽ ghi đè actuator của nhau, và trace/Signals lẫn lộn. Kết quả "chạy thật" mất ý nghĩa. Vì vậy nguyên tắc **một run trên một databroker** là đúng và giữ nguyên. Cần sửa là phạm vi, thời hạn và cách hiển thị.

**Quyết định (ADR-0057):**
1. **Phạm vi khoá theo databroker** (theo release), không còn toàn host: app v4.0 và app v4.2 chạy song song được.
2. **Thời hạn cho run:**
   - tối đa `SV_RUN_MAX_MINUTES` (mặc định 30); hết hạn thì dừng sạch, `stopReason: expired`;
   - 5 phút trước khi hết hạn, UI của chủ run hiện cảnh báo và nút **Extend** (gia hạn thêm một lượt, giới hạn số lần).
3. **Minh bạch:**
   - 409 kèm `activeRun` đã lọc theo quyền: tên app nếu cùng workspace, "another workspace" nếu khác; kèm thời gian đã chạy và thời điểm tự hết hạn;
   - nút Run hiện trạng thái "Vehicle stack busy — frees at hh:mm";
   - System status có thẻ **Vehicle runtime**: databroker nào đang bận, app nào, còn bao lâu.
4. **Giải phóng có kiểm soát:**
   - người cùng workspace có quyền write được **Stop** run đang chiếm;
   - quản trị viên host có `scripts/sv runs list|stop`;
   - app do gate/script tạo (không gắn workspace) chỉ dừng được bằng lệnh quản trị.
5. **Gate và script:** gate live hiện cũng chiếm run. Gate phải chờ chỗ trống (có timeout) thay vì fail, và luôn dừng run khi thoát (đã có trap của M16 cho app; bổ sung cho run).

**Không chọn (ghi ở ADR):**
- databroker riêng cho mỗi run (ephemeral): cô lập tốt nhất nhưng tốn RAM/CPU, khởi động chậm, phải đổi signal-gateway. Đưa vào backlog cho chế độ "lab nhiều người";
- hàng đợi run: người dùng phải chờ mà không biết bao lâu; thời hạn + Stop đơn giản và đủ.

## 4. Trợ lý "Working…" (ảnh 3)

Đây không phải lỗi: endpoint `openai-compatible · local-agent` của PO trả lời chậm (đã đo ở M10, đôi khi 524). Kết quả cuối cùng (workflow LKA trong ảnh 4) hợp lệ. Có một khoảng trống UX nhỏ: trong lúc chờ chỉ có chữ "Working…", không có thời gian đã chờ và không có nút huỷ. Ghi vào M17 như việc nhỏ (T06), không cần ADR riêng.

## 5. Kiểm thử

| Khía cạnh | Kiểm thử |
|---|---|
| Ẩn Chat / Run from block | Unit: danh sách bề mặt ẩn; E2E: không có nút Chat, menu canvas không có "Open Chat", menu block không có "Run from/until block"; route chat của workflow trả 404 |
| Download/Duplicate giữ dữ liệu xe | Unit: JSON tải về có `simvehicleapp.vssRelease` + scenario; import khôi phục; duplicate copy cả hai. E2E: workflow v4.2 có scenario ⇒ duplicate ⇒ bản sao vẫn v4.2, Simulate ra cùng kết quả |
| Khoá run theo databroker | Unit orchestrator: v4.0 đang chạy + start v4.2 ⇒ 202; cùng v4.0 ⇒ 409 kèm `activeRun` đã lọc; hết hạn ⇒ `expired`; Extend; stop bởi người cùng workspace / khác workspace (403) |
| UI bận | E2E mock: 409 ⇒ nút Run hiện "busy — frees at", có Stop khi cùng workspace |
| Gate | `m16-capacity` + gate run mới: hai release chạy song song; hết hạn tự dừng (đặt `SV_RUN_MAX_MINUTES` nhỏ) |
| Quy tắc AGENTS §4 bước 7 | Full luồng `@live`, quay lại video nếu UI đổi, cập nhật README |
