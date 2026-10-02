---
name: upstream-verify
description: Use before relying on any upstream version, file path, API, CLI command, or image tag from Sim (simstudioai/sim), Eclipse Velocitas, KUKSA databroker, COVESA VSS, code-server, or MCP. Re-verifies facts against GitHub instead of memory and records deviations.
---

# Re-verify dữ kiện upstream

Dữ kiện đã verify ngày 2026-09-30 nằm trong `analysis/00-research-findings.md` (bảng pin §1). Upstream thay đổi nhanh — **không trả lời từ trí nhớ**.

## Cách kiểm tra (curl GitHub API/raw; token tuỳ chọn `GITHUB_API_TOKEN`)
```bash
# SHA của tag/branch
curl -sfL https://api.github.com/repos/<owner>/<repo>/git/ref/tags/<tag>
# Liệt kê cây file tại một ref
curl -sfL "https://api.github.com/repos/<owner>/<repo>/git/trees/<ref>?recursive=1" | python3 -c "import json,sys;[print(t['path']) for t in json.load(sys.stdin)['tree']]"
# Đọc file thô tại đúng ref đã pin (KHÔNG dùng main nếu đã pin)
curl -sfL https://raw.githubusercontent.com/<owner>/<repo>/<sha-or-tag>/<path>
# Release mới nhất
curl -sfL https://api.github.com/repos/<owner>/<repo>/releases/latest
```
Ref đã pin: Sim `ad0b8678b5dc4b6d5703481d567f29c9facc6f67` (v0.7.13); cpp-template `275e858e3de8f43d6b4c71a389e358dffe73b42b`; python-template `e7082f75d1831489462f6672b6858f7ea7708256`; cpp-sdk `v0.7.1`; `eclipse-velocitas/devenv-runtimes` (runtime.json, manifest.json); `eclipse-kuksa/kuksa-databroker` tag `0.5.0` cho proto/flags.

## Điểm hay sai (đã biết)
- `custom-blocks` của Sim: không có ở v0.7.13; bản mới là Enterprise.
- Template C++ không còn `generatedModelPath`; AppManifest dùng `"required": "true"`.
- VSS release v4.0 **không** kèm `units.yaml` (v4.2+ mới có).
- C++ SDK chọn API bằng `KUKSA_DATABROKER_API`; Python SDK chỉ `sdv.databroker.v1`.

## Khi phát hiện sai khác
1. Làm theo source thật. 2. Cập nhật `docs/BASELINE.md` nếu là version. 3. Ghi `Notes / Deviations` vào ADR liên quan hoặc viết ADR mới. 4. Nếu sai khác nằm trong `analysis/00-research-findings.md`, sửa file đó và ghi ngày verify mới.
