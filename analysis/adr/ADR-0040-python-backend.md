# ADR-0040: Python backend `compiler-code-python`

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L2
- **Related:** FR-CG-03; [07 §6](../07-codegen-backends.md#6-compiler-code-python-m12); ADR-0020

## Decision
1. Template `vehicle-app-python-template@e7082f7`, `velocitas-sdk==0.15.7`, model `gen/vehicle_model` (`generatedModelPath`).
2. Runtime `simvehicleapp_runtime` (asyncio, 1 event loop = strand tự nhiên); API song song C++ (`signal`, `on_signal_changed`, `Ctx.read/write/wait/stable_for`, policies, trace cùng format).
3. Generator TS sinh `app/src/generated/*.py` + overlay `app/src/main.py`; format bằng `ruff format` ở bước verify (toolchain).
4. Toolchain `toolchain-python` FROM `devcontainer-base-images/python:<pin>`; build = `pip install -r app/requirements.txt` (cache wheel offline) + `pytest`; run = `python3 app/src/main.py` với env SDV_*.
5. Gate: GW-A..E parity pass, không sửa core/studio/orchestrator (chỉ thêm compose file + `SV_BACKENDS`).

## Verification
Chứng minh R10: diff của M12 không chạm `simvehicleapp-core`, `simvehicleapp-studio`, `simvehicleapp-orchestrator` (trừ config).
