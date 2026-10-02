@AGENTS.md

# Claude Code specifics
- Skills dự án nằm ở `.claude/skills/` — dùng skill tương ứng trước khi làm task (bảng ở AGENTS.md §3).
- Khi cần version/API upstream: chạy skill `upstream-verify` (dùng `curl` GitHub API/raw), không trả lời từ trí nhớ.
- Viết tài liệu/ADR bằng tiếng Việt, identifier/code/comment bằng tiếng Anh.
