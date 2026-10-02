# ADR-0022: Chiến lược sinh C++ — continuation-passing, typed model, source map

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-CG-01/06, FR-WF-04; Master Plan ADR-003 (source map), Part 18.7; [04 §7](../04-velocitas-deep-dive.md#7-hình-dạng-code-c-được-sinh-mục-tiêu); [07 §3, §5](../07-codegen-backends.md)

## Decision
1. **Dùng typed vehicle model** (`vehicle::Vehicle` từ Conan `vehicle-model/generated`): path `Vehicle.A.B.C` ⇒ biểu thức member `v.A.B.C` ⇒ compiler C++ kiểm tra tồn tại path lần 2. Ánh xạ tên: giữ nguyên segment VSS cho **tên member/kiểu** (ví dụ `Vehicle.Cabin.Seat` ⇒ member `Cabin`, kiểu `Cabin`) — đã xác nhận không cần escape keyword (xem Notes, đã đóng câu hỏi "spike M6").
2. **Kiểu:** map VSS→C++: boolean→bool, int8..uint64→`intN_t/uintN_t`, float, double, string→`std::string`, T[]→`std::vector<T>`.
3. **Cấu trúc:** mỗi workflow = class `<Name>` với `bind(rt::Runtime&, vehicle::Vehicle&)`; mỗi node có yield = method `step_<id>(rt::Ctx&)`; biểu thức inline; state = member `rt::StateVar<T>`.
4. **App host** `SimVehicleApp` sinh 1 lần/generation, `bindWorkflows()` gọi từng workflow theo thứ tự tên.
5. **Tất định & đẹp:** `CodeWriter` tự indent theo `.clang-format` thật của template — **đã đọc trực tiếp, không còn hedge**: `IndentWidth: 4`, `ColumnLimit: 100`, `UseTab: Never`, `BreakBeforeBraces: Attach` (brace cùng dòng, không xuống dòng), `PointerAlignment: Left` (`int* p` không phải `int *p`), `NamespaceIndentation: None`, `SortIncludes: true`, `Standard: Latest` — danh sách đầy đủ ở `modules/velocitas-stack/templates/vehicle-app-cpp-template/.clang-format`. `CodeWriter` nên sinh code đã khớp sẵn các quy tắc này (không chỉ trông cậy `clang-format --dry-run` để bắt lỗi) để diff/golden ổn định; toolchain vẫn chạy `clang-format --dry-run --Werror` ở bước verify làm lưới an toàn cuối.
6. **Source map (thay ADR-003 cũ):** `CodeWriter` ghi `(file, startLine, endLine) → (workflowId, nodeId, blockId)` cho mỗi node; lưu `generated/sourcemap/*.map.json` và trả trong GeneratedFileSet. Orchestrator dùng để map lỗi GCC/Clang `file:line:col` → block.
7. **An toàn:** chuỗi người dùng → `cppString()` (escape `\\ " \n \t`, non-ASCII → UTF-8 `\u`), identifier → `sanitizeIdent()` + hậu tố hash chống trùng; không macro; không `using namespace` trong header.
8. **Test sinh kèm:** `app/tests/generated/<Name>_test.cpp` chạy scenario golden/user-defined với MockVehicle.
9. Emitter theo opcode, bảng đăng ký; opcode chưa hỗ trợ ⇒ không có trong `backend.yaml.opcodes` (compiler S7 chặn trước).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Template engine (Handlebars/EJS) | Khó kiểm soát indent/source map; logic trong template khó test |
| Datapoint động theo path string (không dùng model) | Mất check compile-time; SDK cần typed DataPoint |
| Coroutine C++20 | Template dùng C++17 |

## Verification
Golden C++ diff = 0; build thật golden project; lỗi C++ cố ý (sửa runtime API giả) map đúng block; fuzz tên/giá trị string không phá compile.

## Notes / Deviations (2026-10-02) — mảng & int64/uint64
Quy tắc codegen cho `std::vector<T>` (đọc, `array.len/at/contains`, bounds-check bắt buộc qua `rt::arrayAt`, không actuator mảng ở v1) và cho `int64_t`/`uint64_t`: xem [ADR-0018](ADR-0018-vss-array-and-full-datatype-coverage.md) §6-7 (quyết định đầy đủ, không lặp lại ở đây để tránh lệch khi 1 trong 2 ADR cập nhật).

## Notes / Deviations (2026-10-01) — đóng câu hỏi "spike M6" về keyword collision
Đọc trực tiếp source `eclipse-velocitas/vehicle-model-generator` (`src/velocitas/model_generator/cpp/cpp_generator.py` + `cpp_keywords.py`, danh sách 100+ keyword C++ tới C++20):
- Hàm `__convert_to_namespace()` (áp dụng `camel_to_snake_case` + hậu tố `_` nếu trùng `cpp_keywords`) **chỉ dùng cho tên namespace/thư mục/include-guard** của branch node (ví dụ branch `Cabin` → namespace/folder `cabin`).
- Tên **member variable và tên class/kiểu** của mọi node (branch, sensor, actuator, attribute) được sinh **y nguyên** từ `node.name`/`child.name` (ví dụ `velocitas::DataPointFloat Speed;`, `cabin::Cabin Cabin;`) — **không qua bất kỳ bước escape/kiểm tra keyword nào**.
- Tuy vậy, **collision cấu trúc không thể xảy ra**: C++ keyword luôn viết thường tuyệt đối (`class`, `new`, `namespace`, …, xác nhận từ `cpp_keywords.py`), trong khi quy tắc đặt tên COVESA VSS **bắt buộc mọi path segment bắt đầu bằng chữ hoa** (PascalCase) — nên một segment VSS hợp lệ không bao giờ trùng y hệt (phân biệt hoa/thường) một keyword C++. Compiler-code-cpp **không cần** thêm bước escape cho path VSS khi sinh biểu thức `v.A.B.C`.
- Hệ quả thực tế duy nhất cần nhớ: namespace nội bộ của model là **snake_case** (`vehicle::cabin::seat::row1::...`), khác PascalCase của path người dùng thấy — nhưng codegen của SimVehicleApp **không bao giờ viết namespace path trực tiếp**, chỉ `#include "vehicle/Vehicle.hpp"` rồi truy cập qua chuỗi member (`vehicle.Cabin.Seat.Row1...`), nên khác biệt namespace này vô hại, không cần xử lý thêm.
- Rủi ro keyword-collision thật sự chỉ còn ở **tên do SimVehicleApp tự sinh** (tên class workflow, tên biến state, tên hàm `step_<id>`) — đã có `sanitizeIdent()` (điểm 7) xử lý, không liên quan tới path VSS.
