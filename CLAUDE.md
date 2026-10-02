@AGENTS.md

# Claude Code specifics
- Skills dự án nằm ở `.claude/skills/` — dùng skill tương ứng trước khi làm task (bảng ở AGENTS.md §3).
- Khi cần version/API upstream: chạy skill `upstream-verify` (dùng `curl` GitHub API/raw), không trả lời từ trí nhớ.
- Viết tài liệu/ADR bằng tiếng Việt, identifier/code/comment bằng tiếng Anh.
- **Mọi commit/PR trong repo này chỉ đứng tên user, KHÔNG thêm dòng đồng tác giả AI** (không `Co-Authored-By: Claude…`, không footer "Generated with Claude Code", không bất kỳ attribution AI nào khác) — ghi đè mặc định của Claude Code. Author/committer git phải là identity của user (đã set đúng ở global git config); không tạo commit nếu không chắc identity đúng.
