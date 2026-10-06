# UPSTREAM_SYNC — simvehicleapp-studio

Baseline: `simstudioai/sim` tag **v0.7.13** = `ad0b8678b5dc4b6d5703481d567f29c9facc6f67` (ADR-0003, `docs/BASELINE.md`).
Nhập vào meta-repo ở commit `68f7f9a` (2026-10-02); tag `studio/baseline-v0.7.13` trỏ vào commit này.

## Kiểm tra baseline (merge-base check, M01-T01)
Giai đoạn dev là một repo (ADR-0009), không có lịch sử git upstream để chạy `git merge-base`. Thay vào đó, CI so tree của thư
mục này với tree upstream tại commit pin:

```bash
python3 scripts/upstream_tree_check.py --repo simstudioai/sim --commit ad0b8678b5dc4b6d5703481d567f29c9facc6f67 \
  --path modules/simvehicleapp-studio --allow modules/simvehicleapp-studio/UPSTREAM_SYNC.allow --list
```
Kết quả 2026-10-03: 12.226/12.226 file upstream **giống từng byte**; 6 file mất bit thực thi khi nhập đã được khôi phục
(commit `ac0f165`). Mọi thay đổi cục bộ phải khớp một glob trong [`UPSTREAM_SYNC.allow`](UPSTREAM_SYNC.allow) — thay đổi chưa
khai báo làm CI fail. Sửa file gốc Sim: tối thiểu, đánh dấu `// SV:` (ADR-0008).

## Chính sách (ADR-0003)
- Không merge/rebase upstream tự động; chỉ **cherry-pick có chọn lọc** bản vá bảo mật/bug ở vùng còn giữ (canvas, store, auth,
  db, realtime). Mỗi lần ghi một dòng vào nhật ký dưới đây (upstream commit, file, lý do, commit của mình).
- Không lấy gì từ `apps/sim/ee/**` hay tính năng Enterprise (ADR-0004).
- Đánh giá upstream mỗi quý (security advisories, CVE dependency); không nâng baseline nếu không có ADR mới.

## Nhật ký cherry-pick
| Ngày | Upstream commit | Phạm vi | Lý do | Commit SimVehicleApp |
|---|---|---|---|---|
| — | — | — | (chưa có) | — |

## Lỗi upstream sửa tại chỗ (chưa có bản vá upstream)
| Ngày | Phạm vi | Lỗi | Bằng chứng | Commit SimVehicleApp |
|---|---|---|---|---|
| 2026-10-06 | `workflow.tsx` — drop từ overlay canvas rỗng, `onDrop`, `onDragOver` | `screenToFlowPosition` của reactflow 11.11 đã tự trừ bounds canvas (`@reactflow/core`: "no need to subtract the react flow bounds anymore"); Sim trừ lần nữa ⇒ block rơi lệch khỏi con trỏ đúng bằng kích thước sidebar/header, thả vào Parallel/Loop sai container | Có ở pin `ad0b8678` và ở `main` `546d4e7e5d50` (2026-10-05); E2E GW-F (thả block vào Parallel) | `7fc6da9` |
