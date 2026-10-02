---
name: implementation-loop
description: Use when writing actual implementation code (not ADR/planning) for any module or task after its ADR is Accepted — enforces the review-doc -> research -> implement -> mismatch-resolution -> doc-sync -> test loop and a production-readiness bar before marking a task done.
---

# Vòng lặp implement chuẩn production

Bổ sung cho `simvehicleapp-phase-execution` (gate ở mức milestone/task) — skill này là **vòng lặp bên trong một task code**, mục tiêu: code merge xong có thể đưa production ngay, không còn lỗi tiềm ẩn do lệch doc/research.

## Vòng lặp bắt buộc (đủ bước, đúng thứ tự)
1. **Review doc**: đọc ADR liên quan — phần *Decision*, không chỉ Context — + `CONTRACT.md`/`BlockSpec`/schema của module + task trong phase file. Không code từ trí nhớ hay giả định "chắc là vậy".
2. **Research** nếu đụng API/version/behavior upstream (Sim, Velocitas, KUKSA, VSS, code-server, MCP) → chạy skill `upstream-verify` (curl source thật), không trả lời từ trí nhớ.
3. **Viết test trước**, phản ánh đúng *Decision* của ADR: unit; thêm golden/contract/conformance nếu đụng IR hay execution semantics (skill `golden-and-parity-tests`).
4. **Implement tối thiểu** để test pass, tuân luật cứng AGENTS.md §2 (không import chéo module, chỉ `workspace` ghi source, tất định, không sửa file do velocitas CLI quản lý…).
5. **Phát hiện mismatch** (ADR nói A, source/test/spike cho thấy B) → DỪNG code, không âm thầm lệch khỏi doc:
   - Ghi rõ bằng chứng cụ thể (file + dòng, commit/SHA, lệnh đã chạy + output, hoặc link source thật).
   - Đề xuất ít nhất 1 phương án, có trade-off, giống format "Alternatives considered" của ADR.
   - ADR còn **Proposed** → sửa trực tiếp Decision. ADR **Accepted** → thêm mục "Notes / Deviations" (không sửa Decision gốc), hoặc nếu đổi kiến trúc thật ⇒ ADR mới `Supersedes ADR-XXXX` (skill `adr-writing`).
   - Mismatch đổi luật cứng AGENTS.md §2 hoặc đổi Decision cốt lõi của ADR Accepted ⇒ hỏi user trước khi tiếp tục. Mismatch chỉ là chi tiết implementation (tên hàm, cấu trúc file nội bộ, thứ tự xử lý) ⇒ tự chọn phương án tốt nhất, ghi lại, không hỏi.
   - Cập nhật xong doc rồi mới quay lại code — doc không bao giờ lạc hậu hơn code đã merge.
6. **Implement lại** đúng theo doc vừa cập nhật.
7. **Test toàn diện** trước khi coi task xong: unit + contract + golden/parity liên quan + type-check/lint + build thật của đúng module (không giả định "sẽ pass" — phải thấy output thật). Nếu đụng compose: `docker compose -f modules/<m>/compose.yaml config -q` phải valid độc lập.
8. **Lỗi** → sửa tại root cause (không try/catch rỗng, không nới dung sai test, không workaround che dấu hiệu). Nếu lỗi lộ ra thêm gap trong doc → quay lại bước 5, lặp đến khi hết mismatch.

## Checklist "production-ready" trước khi đánh dấu task xong
- **Determinism**: chạy lại 2 lần cùng input ⇒ cùng bytes (không timestamp/random lọt vào IR hay file sinh).
- **Biên dữ liệu**: null/empty/mảng rỗng, overflow int64/uint64 (phải string-encode theo ADR-0018), giá trị ngoài `allowed`/`min`/`max`, timeout, race giữa async step.
- Không còn TODO/stub/mock nào che giấu một đường chạy thật trong code sẽ merge.
- Error path có test riêng — không chỉ test happy path.
- **Mã diagnostic**: chỉ thêm, không đổi tên/xoá mã đã publish (luật cứng #8).
- Không import chéo `modules/<m>`; build context của module không trỏ ra ngoài thư mục module (luật cứng #2).
- **License**: không dòng nào copy từ Scratch hay `apps/sim/ee/` (skill `license-compliance`).
- Đổi bề mặt API/contract ⇒ đã có ADR + bump version + test đồng bộ (`block-parity.test.ts` nếu là block, contract test nếu là service).

## Khi nào hỏi user thay vì tự quyết
Chỉ khi mismatch đòi đổi Decision cốt lõi của một ADR **Accepted**, đổi luật cứng AGENTS.md §2, hoặc kéo theo chi phí/rủi ro lớn (đổi dependency chính, đổi license, đổi kiến trúc cross-module). Mọi chi tiết implementation khác — tự quyết theo convention đã có trong repo, ghi lại lý do, không dừng để hỏi.
