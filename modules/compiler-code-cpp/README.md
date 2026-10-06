# compiler-code-cpp

Backend C++ của SimVehicleApp (tầng L4, ADR-0020/0021/0022/0023): IR v1 ⇒ vehicle app Velocitas C++ (SDK 0.7.1)
chạy trên runtime `simvehicleapp-runtime-cpp`. Spec: [analysis/modules/compiler-code.md](../../analysis/modules/compiler-code.md),
[analysis/07](../../analysis/07-codegen-backends.md). Chỉ phụ thuộc contracts (`file:../../simvehicleapp-contracts`).

| Thư mục | Nội dung |
|---|---|
| `generator/` | Service `codegen-cpp` :4110 (Bun, TypeScript): `/capabilities`, `/generate`, `/runtime/files`, `/template-overlay/files` — thuần, tất định, không mạng |
| `runtime/` | Thư viện C++17 `simvehicleapp::rt`: strand (t, seq), interpreter run/fiber/policy/trace theo ngữ nghĩa simulator (ADR-0017 Notes), `testing::MockVehicle`/`MockPubSub`/`runScenario`; adapter Velocitas (`VelocitasVehicleAccess`, `AppBase`) chỉ build trong project (`SV_RT_VELOCITAS=ON`) |
| `template-overlay/` | File cài một lần vào project mới (CMake của `app/src`, `app/tests`, `user/UserHooks.*`) + danh sách file template bị thay (`overlay.json`) |
| `golden/` | Snapshot C++ của GW-A…GW-G (diff = 0) |
| `backend.yaml` | Manifest plugin (= `GET /capabilities`) |

```bash
cd generator && bun install --frozen-lockfile
bun run check && bun test                          # generator: golden C++, determinism, contracts, fuzz
SV_UPDATE_GOLDEN=1 bun test                        # cập nhật golden/ (review diff)
conformance/conformance.sh                         # P1 (ADR-0042): 38 conformance + 7 golden, C++ thật trên MockVehicle
SV_CONF_CXXFLAGS="-fsanitize=address,undefined" conformance/conformance.sh

cmake -S ../runtime -B build && cmake --build build -j2 && ctest --test-dir build   # unit test runtime (gtest)
```
Conformance và unit test runtime cần cmake ≥ 3.16 + compiler C++17 (g++ 11 như toolchain). TSAN: build với
`-fsanitize=thread`, chạy bằng `setarch -R` (TSAN của GCC 11 không chạy với ASLR entropy cao của kernel mới).
