# ADR-0055: Block thể hiện logic bằng hình: câu tóm tắt, màu theo loại, cổng và cạnh có nhãn, chip dữ liệu

- **Status:** Proposed
- **Date:** 2026-10-14
- **Level:** L2 Component
- **Deciders:** PO yêu cầu 2026-10-14; agent đề xuất theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- **Related:**
  - ADR-0011 (mô hình block trên canvas), ADR-0013 (handle/edge), ADR-0004 (clean-room, không dùng Scratch);
  - thiết kế [M16](../../docs/design/M16-ux-and-capacity.md) §3.5.

## Context
- Block xe đang dùng thẻ chung của Sim (`workflow-block.tsx`): mỗi prop là một dòng key/value chữ 10–11px. Một chuỗi như GW-A trông như 4 hộp chữ nối thẳng, không đọc được "khi … nếu … thì …".
- Cạnh (`workflow-edge.tsx`) không có nhãn, chỉ cạnh `error` được tô đỏ. Các nhánh `then/else`, `stable/broken`, `ok/timeout` trông giống hệt nhau. Nhãn handle bên phải block rất nhỏ.
- Tham chiếu dữ liệu giữa block (`<speedchanged.value>`) chỉ nằm trong chuỗi biểu thức, không thấy được trên canvas.
- PO: "block kết hợp lẫn nhau chưa miêu tả một cách tượng hình logic".

## Decision
1. **Câu tóm tắt** ở đầu mỗi block `sv_*`:
   - Sinh bằng hàm thuần `summarizeSvBlock(type, props, ctx) → { text, emphasis[] }` trong `lib/sv/block-summary.ts`. Mỗi BlockSpec có một quy tắc; có fallback cho block chưa có quy tắc.
   - Câu tiếng Anh, theo ngôn ngữ UI hiện tại; i18n để sau.
   - Các dòng key/value giữ bên dưới, thu gọn.
   - Ví dụ:
     - "When Vehicle.Speed changes";
     - "If speed > 120 holds 2 s";
     - "Set Hazard.IsSignaling = true";
     - "Notify HMI (warning): Overspeed".
2. **Màu theo loại:** một token màu cho mỗi `category` của BlockSpec (trigger, vehicle-read, vehicle-write, logic, flow, state, comm, composite).
   - Trigger có viền trái đậm và nhãn nhỏ "WHEN"; hành động ghi lên xe có nhãn "DO".
   - Màu dùng biến CSS có sẵn hoặc khai báo cục bộ ở component, không sửa style toàn cục (luật studio).
3. **Cổng và cạnh có nhãn:**
   - Cổng ra nhánh có nhãn ngắn và màu: `then` = true (xanh), `else` = false (xám), `stable` (xanh), `broken` (cam), `ok` (xanh), `timeout` (cam), `error` (đỏ).
   - Cạnh xuất phát từ cổng nhánh hiện nhãn đó ở giữa đường. Cạnh `source` thường không có nhãn.
   - Ánh xạ handle → nhãn/màu đặt ở **một bảng** dùng chung cho block và cạnh.
4. **Chip dữ liệu:**
   - Block có biểu thức tham chiếu block khác hiện chip "uses: speedchanged.value".
   - Rê chuột lên chip thì làm nổi block nguồn; tham chiếu không hợp lệ đã được lint báo `DATA_REF_NOT_DOMINATING`.
   - Tham chiếu được trích bằng parser biểu thức có sẵn trong studio, không viết parser thứ hai.
5. **Chỉ là hiển thị:**
   - Không đổi WorkflowGraph, IR hay code sinh ra.
   - Không thêm field vào block state; mọi thứ suy ra từ `type` + `props` + edges.

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Khối ghép hình kiểu Scratch | Trực quan nhất | Viết lại canvas; rủi ro license (Scratch AGPL, luật cứng 4) | Lấy ý tưởng chung (màu/câu), không lấy hình |
| Vẽ cạnh dữ liệu (data edge) riêng | Hiển thị luồng dữ liệu đầy đủ | Canvas rối, trùng cạnh điều khiển | Chip + highlight khi rê chuột là đủ |
| Chỉ tăng cỡ chữ | Rẻ | Vẫn không đọc được logic | Không đạt mục tiêu |

## Consequences
- **Tích cực:**
  - Workflow đọc được như câu.
  - Nhánh nhìn là phân biệt được.
  - Thấy được block nào dùng dữ liệu của block nào.
- **Tiêu cực:**
  - Mỗi BlockSpec mới phải thêm một quy tắc tóm tắt. Có test bảo đảm mọi spec có quy tắc hoặc fallback có chủ đích.
- **Module bị ảnh hưởng:**
  - studio: `workflow-block.tsx` (khu vực đầu thẻ cho `sv_*`), `workflow-edge.tsx` (nhãn), `lib/sv/block-summary.ts`, `lib/sv/handle-labels.ts`;
  - khai báo thay đổi file Sim trong `UPSTREAM_SYNC.allow`.

## Implementation
| Task | Module | Milestone |
|---|---|---|
| `block-summary` + `handle-labels` + test cho mọi BlockSpec | studio | M16-T08 |
| Đầu thẻ `sv_*` (câu + màu + nhãn loại) + nhãn cổng | studio | M16-T08 |
| Nhãn cạnh + chip dữ liệu + highlight | studio | M16-T09 |

## Verification
- **Vitest:**
  - mỗi BlockSpec ⇒ câu đúng với bảng props mẫu, bao gồm composite, filter, state machine;
  - mỗi handle ⇒ nhãn/màu;
  - trích tham chiếu.
- **Không hồi quy:** golden graph-adapter, golden IR, conformance C01–C45, parity P3 không đổi byte nào.
- **E2E:** GW-A hiện "When Vehicle.Speed changes", cạnh `stable` có nhãn; `m3-goldens` vẫn khớp graph.
