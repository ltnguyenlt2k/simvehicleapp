---
name: upstream-verify
description: Verify pinned upstream APIs, paths or behavior for Sim, Velocitas, KUKSA, VSS, code-server or MCP; research missing evidence and record drift.
---

# Xác minh upstream đúng pin

Pin/provenance: `docs/BASELINE.md`, `analysis/00-research-findings.md`, `UPSTREAM.md` của module. Không lấy version/API từ trí nhớ và không đổi pin sang latest.

1. Xác định đúng câu hỏi và ref. Kiểm file vendored, lock/schema/proto, cache/toolchain và spike report có provenance khớp pin. Đọc declaration/implementation liên quan, không tải toàn cây upstream. Dữ kiện bất biến ở commit/digest đã pin có thể xác minh local; không tải lại mỗi task nếu bằng chứng đủ.
2. Thiếu source, lệch pin, nghi ngờ behavior hoặc task nâng version ⇒ tra nguồn chính thức đúng SHA/tag và file cần dùng. Thông tin động (latest, hỗ trợ hiện tại, API hosted/provider) phải kiểm online tại lúc dùng; historical research không đủ. Tuân yêu cầu browse/xác minh của môi trường.
3. Khi cần tải, dùng GitHub API ref/tag hoặc raw `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`; chỉ tìm latest khi nhiệm vụ thật sự cần. Không in token/env secret. Ghi ref + file/đoạn source hay lệnh/output trong doc/PR thích hợp để tái sử dụng.
4. Source thật khác analysis ⇒ dùng source, ghi `Notes / Deviations` trong ADR; version đổi cập nhật BASELINE và research liên quan. Đổi contract/kiến trúc cần ADR; không tự nâng dependency.

Bẫy đã ghi nhận: custom-blocks Sim là EE; AppManifest dùng `required: "true"`; VSS v4.0 không có units.yaml trong release; C++ chọn API bằng KUKSA_DATABROKER_API, Python pinned dùng sdv v1. Đây là điểm cần đối chiếu source khi chạm, không phải lý do research lại toàn stack.
