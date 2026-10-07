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

## Notes / Deviations

### 2026-10-07 — hiện thực M12 (Claude Code, theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận)
1. **Runtime = port runtime C++, không phải "một `asyncio.Task` mỗi run".** `simvehicleapp_runtime` giữ đúng mô hình của
   `compiler-code-cpp/runtime` (strand sắp theo `(t, seq)`, run = tập fiber dùng chung cancel token, continuation): thứ tự
   sự kiện cùng thời điểm, `seq` của trace và cách huỷ khớp simulator/C++ từng byte (conformance P1 **46/46**: 38 C + 7
   golden so toàn bộ `expected.trace.json` + fuzz chuỗi). asyncio chỉ là đồng hồ thật và event loop của SDK
   (`Strand.run()`); callback SDK chỉ `post` lên strand. Phương án `asyncio.Task.cancel()` của analysis/07 §6 bỏ vì không
   tất định ở cùng mili-giây và không cho cùng `seq`.
2. **Code sinh = builder `bind(runtime)` + lambda** (như ADR-0022 Notes của C++), không phải API `await c.read()`: mỗi
   trigger/node IR một lời gọi `w.<opcode>(…)`, biểu thức IR thành `lambda c: V.<helper>(…)` gọi `values.py` (port
   `values.ts`), kiểu tĩnh nướng sẵn. `?:`, `&&`, `||` lười như simulator.
3. **Host SDK theo VSS path**: `VehicleDataBrokerClient` của velocitas-sdk 0.15.7 (`GetDatapoints`/`SetDatapoints`/
   `Subscribe("SELECT <path>")`, `sdv.databroker.v1`) thay vì model typed `vehicle` — đã kiểm mã nguồn wheel 0.15.7.
   MQTT của SDK chỉ trả payload ⇒ giao theo filter đăng ký (như `onlyFilter` của C++). Kiểm "model" lúc build bằng
   `python3 -m simvehicleapp_runtime.check_project` (tín hiệu + datatype của `generated/app.py` so với VSS của
   AppManifest) thay `static_assert` C++. Model `gen/vehicle_model` của template vẫn được sinh (cho code người dùng).
4. **Code sinh ổn định với `ruff format` 0.9.10** (pin của `.pre-commit-config.yaml` template): generator tự dàn trang
   theo luật black (dài 88, `layout.ts`) ⇒ bước format-check = `ruff format --check` + `ruff check` trên
   `app/src/generated`, `app/tests/generated` có nghĩa thật (198 file của conformance đều PASS). Không bao giờ chạy
   formatter ghi đè (luật cứng 3).
5. **Vendor path** `app/src/simvehicleapp-runtime/` giống C++ (thư mục chứa package `simvehicleapp_runtime`);
   `main.py` (overlay, dẫn xuất từ `main.py` template, giữ header Apache-2.0) và `conftest.py` sinh ra thêm vào
   `sys.path`. Overlay gỡ `app/tests/unit/test_run.py` mẫu.
6. **Job toolchain Python**: deps = `pip3 install -r app/requirements.txt -r app/tests/requirements.txt` (wheelhouse
   offline trong image); build = `compileall` + `check_project`; test = pytest các file sinh với plugin
   `simvehicleapp_runtime.pytest_gtest` in dòng kiểu gtest (`[ RUN ]`, `[  FAILED  ]`, tổng kết) để orchestrator gán lỗi
   về đúng workflow như C++ (pytest exit 5 = chưa có scenario ⇒ không phải lỗi); format-check như mục 4; run =
   `python3 -u app/src/main.py`.
7. **Compose: profile `python`** (đúng analysis/12 §1) thay vì file `compose.lang-python.yaml`: compose-lint bắt root
   include mọi fragment module, nên dịch vụ Python nằm trong fragment của module với `profiles: ["python"]`
   (`codegen-python` :4120, `toolchain-python` :4220, `ide-python` :8081). Bật: `COMPOSE_PROFILES=python` +
   `python=…` trong `SV_BACKENDS`/`SV_TOOLCHAINS` (+ `SV_IDE_PUBLIC_URL` theo ngôn ngữ) — xem `.env.example`.
8. **R10 — lệch tiêu chí "không chạm core/studio/orchestrator"** (bằng chứng: diff M12). Rà R10 tìm ra các chỗ chỉ biết
   C++; sửa theo hướng trung lập ngôn ngữ để backend sau (Rust M13) không phải sửa nữa:
   - workspace: map `RUNTIME_PREFIX = { cpp: … }` ⇒ ngôn ngữ cài đặt = `SV_BACKENDS ∩ SV_TOOLCHAINS`, một vendor path
     chung (`backend.yaml runtime.vendorPath`);
   - orchestrator: gán test lỗi theo `workflows/<tên>.<đuôi bất kỳ>` (trước: `.cpp`); link IDE theo ngôn ngữ
     (`SV_IDE_URL` một URL hoặc `cpp=…,python=…`); README/NOTICE/THIRD-PARTY của export theo ngôn ngữ (trước: luôn C++);
   - studio: chọn ngôn ngữ khi tạo project (trước: cố định C++), chỉ hiện ngôn ngữ có `codegen-*` + `toolchain-*` đang
     chạy (System status). Contract BFF thêm trường tuỳ chọn `language` (mặc định `cpp`), không phá tương thích.
   Core (compiler) không phải sửa. Không thêm mã diagnostic.
