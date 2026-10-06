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

## Notes / Deviations (2026-10-07) — triển khai M07-T06…T11 (`modules/simvehicleapp-orchestrator/services/workspace`), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Path policy** đúng contracts `relativePath`: từ chối (không tự sửa) đường dẫn tuyệt đối, `..`, `.`, segment rỗng, backslash, ký tự điều khiển; file phải nằm trong ownedRoots ⊆ `{app/src/generated/, app/tests/generated/}` (ADR-0023 §3); mọi thành phần đường dẫn đã tồn tại không được là symlink. Lỗi ⇒ 422 `WORKSPACE_PATH_REJECTED`.
2. **Commit:** staging chứa **toàn bộ** nội dung mới của mỗi owned root (file không còn trong file set biến mất cùng root cũ), AppManifest merge + `manifest-managed.json` + file set nén; journal `prepared` ⇒ swap bằng `rename` ⇒ journal `swapped` ⇒ record ⇒ dọn. Khởi động: `prepared` ⇒ khôi phục root `.old-<gid>` và AppManifest cũ; `swapped` ⇒ hoàn tất. Fault injection ở 3 điểm (sau staging, giữa swap, sau swap): mỗi root hoặc toàn cũ hoặc toàn mới, project commit tiếp được (test).
3. **File set phải mang `simvehicleapp.gen.json` hợp lệ** (contracts generation-manifest) — record của workspace lấy `workflows/contracts` từ đó; thiếu ⇒ 422 `WORKSPACE_COMMIT_FAILED` (trước đó record có thể sai contract: `workflows` rỗng).
4. **GENERATED_FILE_MODIFIED:** so mọi file trên đĩa trong owned roots với record hiện tại (sửa, thêm, xoá) ⇒ 409 (≤ 50 diagnostic, mỗi file một cái); `overwriteModified` ⇒ backup `.sv/backup/<gid>/` rồi ghi.
5. **Init:** template tar của toolchain (giải nén trong staging) + overlay backend (`remove` trước, rồi file) + runtime (chỉ dưới `app/src/simvehicleapp-runtime/`) + VSS của release (giữ file seed nếu trùng release, ngược lại lấy `GET /vss` của vss-catalog, thêm mới M7) + AppManifest (`name`=appName, xoá entry của sample app) + `.simvehicleapp/project.json` ⇒ `rename` vào `projects/<slug>`. Lỗi bất kỳ ⇒ không có project, staging bị xoá.
6. **API thêm cho trình xem file (M07-T19, additive):** `GET /projects/{slug}/file`, `/generations`, `/generations/{gid}/file`. `export` trả 501 tới milestone export (M9).
7. Chạy uid 4000, volume `sv-workspace` dùng chung với toolchain/IDE; network `sv-internal` + `sv-codegen`. Kiểm thử tích hợp trên stack dev: tạo project thật (template + overlay + runtime + catalog) ⇒ toolchain `init` 30 s, `deps` 3 s offline.

## Notes / Deviations (2026-10-07) — orchestrator + studio M07-T12…T19, theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
8. **Schema `sv` do chính orchestrator migrate** (SQL `services/orchestrator/migrations/0001_sv_init.sql`, chạy lúc khởi động trong một transaction dưới `pg_advisory_xact_lock`, ghi `sv.schema_migration`) thay cho "Drizzle, migration chạy trong `migrations` service" của phase M07-T12. Lý do: Drizzle schema nằm trong `packages/db` của studio; để studio migrate schema của orchestrator là vi phạm sở hữu dữ liệu (ADR-0007 §4) và luật không import chéo module. Bảng: `project`, `project_workflow`, `generation` (stages + verification JSONB; cũng là hàng đợi SynCode: `FOR UPDATE SKIP LOCKED` — không cần bảng `job` riêng), `generation_event` (log để nối lại SSE); `run`/`run_event` để M8 thêm bằng migration mới. Test: `repo.pg.test.ts` trên Postgres thật (CI job `orchestrator`).
9. **Liên kết workspace ↔ project ở phía studio:** orchestrator không biết workspace/user của Sim (ADR-0007 §5 — chỉ tin header nội bộ). Studio giữ bảng `sv_projects(id = project id của orchestrator, workspace_id, slug unique, created_by)` (migration Sim `0252`) và BFF kiểm quyền workspace (`checkWorkspaceAccess`) trước mọi lời gọi `/api/sv/projects/*`; danh sách chỉ trả project được liên kết với workspace.
10. **SynCode gửi graph dựng ở server:** BFF dựng WorkflowGraph cho mọi workflow được bật của project từ trạng thái đã lưu (cùng `adaptWorkflow` của editor, release = release ghim của workflow hoặc của project), riêng workflow đang mở dùng graph của editor (có thể mới hơn bản lưu); kèm scenario đã lưu (test sinh kèm, ADR-0022 §8). Adapter phải bỏ phần không hợp lệ (container/biến) ⇒ BFF trả 422 kèm diagnostic, không sinh app thiếu phần.
11. **Build log:** studio relay SSE `/events?generationId=` của orchestrator (`id:` = seq, trình duyệt nối lại bằng `Last-Event-ID`); trạng thái/verdict lấy từ `GET …/generations/{gid}` (Appendix A/B). Diagnostic có `blockId` của workflow đang mở ⇒ bấm để chọn block.
