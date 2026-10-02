# ADR-0026: Workspace service — single writer, atomic commit, path security

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** NFR-03/04; Master Plan 3.5, 8.4, 12.2; Phase 17

## Decision
1. Chỉ `workspace` ghi source vào `/workspace/projects/**` (toolchain chỉ ghi `build*/`, `.velocitas` cache; IDE là người dùng).
2. **Init project:** lấy template tar từ toolchain (`GET /templates?lang=cpp`) + overlay từ backend + runtime files ⇒ ghi vào `/workspace/.sv/staging/<id>` ⇒ rename thành `/workspace/projects/<slug>` (atomic, cùng filesystem).
3. **Commit generation:**
   1. Validate mọi path: normalize, không tuyệt đối, không `..`, nằm trong `ownedRoots` hoặc là `appManifestPath`; realpath không thoát project; không ghi qua symlink.
   2. Kiểm tra file owned hiện có so với manifest generation trước: checksum khác ⇒ `GENERATED_FILE_MODIFIED` (warning; UI cho chọn "ghi đè" / "huỷ"); backup vào `.sv/backup/<generationId>/`.
   3. Ghi toàn bộ vào staging `.sv/staging/<generationId>/` (mirror cấu trúc) + fsync.
   4. Merge AppManifest (ADR-0023) vào staging.
   5. **Swap:** với mỗi owned root: `rename(root, root.old-<gid>)`, `rename(staging/root, root)`; xoá `.old` sau khi ghi generation manifest; lỗi giữa chừng ⇒ rollback bằng `.old`. Journal `.sv/journal/<gid>.json` cho phép recovery khi khởi động.
   6. Ghi `.sv/generations/<slug>/<gid>.json` (Generation Manifest: files+sha, irHash, versions).
4. Rollback về generation trước = commit lại file set cũ (lưu nén 10 generation gần nhất).
5. Export zip stream theo ignore list.
6. Chạy non-root **uid 4000** (khớp user `vscode` trong toolchain/IDE — verified M0) ⇒ không lỗi quyền.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Git commit trong project làm cơ chế atomic | Người dùng có thể dùng git riêng trong IDE; xung đột |
| Ghi từng file trực tiếp | Half-written khi lỗi |

## Verification
Fault injection (kill process sau bước 3, giữa bước 5) ⇒ khởi động lại recovery sạch; test path traversal (`../../etc/passwd`, symlink) bị từ chối.
