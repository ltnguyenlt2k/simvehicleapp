# Build image studio — Bun, Next.js và cách build nhẹ mà không giảm độ chính xác

> Phân tích 2026-10-06 theo yêu cầu PO (máy dev WSL ~11 GB RAM bị tràn khi build/test studio).

## 1. Bun hay Next/Node — thực tế trong source (Sim v0.7.13 fork)

| Bước | Công cụ thật | Bằng chứng |
|---|---|---|
| Cài dependency | **Bun** (`bun install --linker=hoisted`) | `docker/app.Dockerfile` stage `deps` |
| Biên dịch native `isolated-vm` | **Node** (`npx node-gyp rebuild`) | stage `deps` |
| Biên dịch app | **Next.js 16 `next build`** (Turbopack, Rust) do `bun run build` gọi, heap Node 8 GB | `apps/sim/package.json` script `build` |
| Chạy server | **Bun** chạy `server.js` của Next standalone | `CMD ["bun", "apps/sim/server.js"]` |
| Chạy code người dùng (block Function của Sim) | **Node** (`spawn('node', …isolated-vm-worker.cjs)`) | `apps/sim/lib/execution/isolated-vm.ts` |

⇒ "Build bằng Bun" và "build bằng Next/Node" **không phải hai phương án thay thế nhau**. Bun chỉ là package manager, script runner và runtime của server. Phần nặng là trình biên dịch Next/Turbopack: với >1 000 integration của Sim, upstream build trên runner 32 GB và đặt heap 8 GB. Không có cấu hình build bằng Bun nào nhẹ hơn mà vẫn ra đúng bundle.

## 2. Đo đạc

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| RAM studio khi chạy (idle) | ~73 MB | `docker stats`, image sha-35d1ec6 |
| RAM realtime | ~112 MB | |
| RAM `next build` | > 8 GB heap + bộ nhớ native Turbopack | CI cần runner 16 GB + 16 GB swap |
| Image runtime trước khi gọn | 2,08 GB | mang theo python3/pip, make/g++, ffmpeg của stage build |

## 3. Quyết định

1. **Chỉ CI build image studio.** Máy dev không chạy `next build`. `scripts/sv refresh` chờ CI xanh rồi tải đúng image mà CI đã dùng để chạy E2E (artifact `studio-image`, tải song song 16 range). Local chạy **cùng byte** với bản đã kiểm, nên độ chính xác giữ nguyên, thậm chí cao hơn build lại ở local.
2. **Stage `runtime` gọn:** chỉ có Bun 1.3.13 + Node 22 (NodeSource 22.x, cùng nguồn với stage `deps`, nên `isolated-vm` giữ đúng ABI). Bỏ python3/pip, make/g++, ffmpeg khỏi image chạy. Không chỗ nào ở runtime dùng chúng: ffmpeg chỉ xuất hiện dạng chuỗi trong catalog copilot; không có spawn python; studio không có healthcheck dùng curl. Bằng chứng không đổi hành vi: E2E M1/M2/M3 (gồm 7 golden + restart) chạy trên chính image mới trong CI.
3. **Dọn image cũ:** `sv refresh` giữ image đang chạy và một bản trước để rollback, xoá các tag `sha-*` cũ hơn (mỗi bản khoảng 2 GB đĩa). Chỉ xoá tag image, không đụng container hay volume.
4. **Kiểm chứng local vẫn chạy**, nhưng tuần tự từng tác vụ nặng: test core/contracts (bun, nhẹ), Vitest studio theo file với 1 worker, E2E trên image CI với stack `sv-e2e`. Không chạy hai stack studio cùng lúc.

## 4. Phương án đã cân nhắc và loại

| Phương án | Vì sao loại |
|---|---|
| Hạ heap `next build` (vd 4 GB) để build local | Upstream đã cần 8 GB; hạ xuống dễ OOM hoặc build chậm, không bảo đảm |
| `bun --bun next build` (Next chạy trên Bun runtime) | Turbopack là native Rust nên bộ nhớ gần như không đổi; đường build không được upstream kiểm, rủi ro sai bundle |
| `next dev` thay cho image | Biên dịch theo trang khi truy cập, nặng hơn lúc chạy, khác hành vi production |
| Cắt integration của Sim để giảm module graph | Đổi sản phẩm, lệch fork lớn, ngoài phạm vi |

## 5. Lệnh

```bash
scripts/sv refresh          # chờ CI của HEAD, tải image studio đã kiểm, build image nhỏ (migrations/realtime/core), up -d
scripts/sv refresh --latest # dùng run xanh mới nhất trên main
```
