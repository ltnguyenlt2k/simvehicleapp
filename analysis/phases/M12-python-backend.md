# M12 — `compiler-code-python` + toolchain-python + ide-python

**ADR:** 0040 · **Phụ thuộc:** M11

| ID | Task | Test |
|---|---|---|
| M12-T01 | Vendor python template @e7082f7; `toolchain/python/Dockerfile` (base python devcontainer image pin, wheel cache offline, model VSS 4.0) | offline build |
| M12-T02 | Agent jobs cho python: deps (pip), test (pytest), format-check (ruff), run (python3 app/src/main.py) | contract |
| M12-T03 | Runtime `simvehicleapp_runtime` (asyncio) + conformance runner | 100% conformance |
| M12-T04 | Generator TS: emitters Python, naming, `pyString`, source map, overlay main.py | golden GW-A..G |
| M12-T05 | `compose.lang-python.yaml`, `SV_BACKENDS`/`SV_TOOLCHAINS` bổ sung, ide-python | smoke |
| M12-T06 | Project language = python trên UI (đã có trường) | E2E |

**Gate:** GW-A..E live + parity; diff M12 không chạm studio/core/orchestrator code (R10 chứng minh).
