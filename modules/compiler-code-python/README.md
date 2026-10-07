# compiler-code-python

Backend Python của SimVehicleApp (tầng L4, ADR-0020/0040): IR v1 ⇒ vehicle app Velocitas Python
(`velocitas-sdk==0.15.7`, template `vehicle-app-python-template@e7082f7`) chạy trên runtime `simvehicleapp_runtime`.
Spec: [analysis/07 §6](../../analysis/07-codegen-backends.md), [ADR-0040](../../analysis/adr/ADR-0040-python-backend.md).
Chỉ phụ thuộc contracts (`file:../../simvehicleapp-contracts`).

| Thư mục | Nội dung |
|---|---|
| `generator/` | Service `codegen-python` :4120 (Bun, TypeScript): `/capabilities`, `/generate`, `/runtime/files`, `/template-overlay/files` — thuần, tất định, không mạng. Code sinh ra được dàn trang đúng như `ruff format` 0.9.10 (`layout.ts`) |
| `runtime/` | Package `simvehicleapp_runtime` (Python ≥ 3.10, không phụ thuộc ngoài): strand (t, seq) đồng hồ ảo/thật (asyncio), interpreter run/fiber/policy/trace port từ runtime C++ (ngữ nghĩa simulator, ADR-0017 Notes), `values` port `values.ts`, `testing` (MockVehicle/MockPubSub/`run_scenario`); `velocitas.py` = host trên SDK (`sdv.databroker.v1` theo VSS path, MQTT theo filter) |
| `template-overlay/` | File cài một lần vào project mới (`app/src/main.py` chạy workflow sinh ra, `app/src/user_hooks.py`) + file template bị gỡ (`overlay.json`) |
| `golden/` | Snapshot Python của GW-A…GW-G (diff = 0) |
| `backend.yaml` | Manifest plugin (= `GET /capabilities`) |

Project sinh ra: `app/src/generated/` (mỗi workflow một module `bind(runtime)`, `app.py`), `app/tests/generated/`
(pytest theo scenario), runtime vendor ở `app/src/simvehicleapp-runtime/` (cùng vendor path với C++).

```bash
cd generator && bun install --frozen-lockfile
bun run check && bun test                          # generator: golden Python, determinism, contracts, fuzz
SV_UPDATE_GOLDEN=1 bun test                        # cập nhật golden/ (review diff)
SV_RUFF=ruff conformance/conformance.sh            # P1 (ADR-0042): 38 conformance + 7 golden + fuzz, + ruff format/check

python3 -m pytest -q ../runtime/tests              # unit test runtime (test host SDK cần app/requirements.txt của template)
```
