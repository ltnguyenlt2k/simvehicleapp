# 14 — Testing Strategy, CI Gates & Security Checklist

> Đảm bảo yêu cầu "chạy chính xác, không lỗi, ra product". Liên quan: [ADR-0042](adr/ADR-0042-semantic-parity-testing.md), golden corpus [05 §5](05-blocks-and-execution-model.md#5-golden-workflow-corpus-vss-40--path-đã-verify).

---

## 1. Kim tự tháp test (theo module)

| Tầng test | Ở đâu | Công cụ | Chạy khi |
|---|---|---|---|
| Unit | mọi module | `bun test` (TS), gtest/ctest (runtime C++), pytest | mỗi PR của module |
| Contract | mọi module có API | validate req/resp với JSON Schema từ `simvehicleapp-contracts` (ajv); Pact-style fixtures | mỗi PR |
| Golden (snapshot) | core (graph→IR), compiler-code-* (IR→files) | snapshot file, diff = 0; cập nhật chỉ bằng `--update-golden` + review | mỗi PR |
| Determinism | core, compiler-code-* | chạy 2 lần + trên 2 máy CI khác → hash bằng nhau | mỗi PR |
| Runtime conformance | compiler-code-* | chạy `conformance/*.scenario.yaml` trên runtime với MockVehicle + VirtualClock → so trace kỳ vọng | mỗi PR |
| Compile | meta-repo | build thật golden project bằng toolchain image (offline) | nightly + PR chạm codegen/runtime/toolchain |
| Integration | meta-repo | compose (databroker+mqtt+toolchain) chạy app, scenario player inject, assert writes | nightly |
| Semantic parity | meta-repo | trace(simulator) ≡ trace(binary) cho mọi golden | nightly, gate release |
| E2E UI | meta-repo `tests/e2e` | Playwright: tạo workflow bằng kéo thả → Verify → Simulate → SynCode → Run → thấy signal | nightly, gate release |
| Upgrade/migration | studio, core | mở workflow blockVersion cũ → migrate → IR như cũ | mỗi PR chạm block |
| Fault injection | workspace | kill giữa commit → không file half-written | mỗi PR workspace |
| Performance | core, orchestrator | validate 200 block < 300 ms; simulate 10 phút virtual < 1 s | nightly |

## 2. Golden corpus layout (trong `simvehicleapp-contracts/fixtures/golden/`)
```
golden/GW-A-stable-overspeed/
├── graph.json              # WorkflowGraph v1
├── sim-state.json          # BlockState/Edge gốc của Sim (test adapter)
├── ir.json                 # kỳ vọng IR
├── scenario.yaml           # input: [{t: 0, path: Vehicle.Speed, value: 100}, {t: 1000, value: 130}, ...]
├── expected.trace.json     # TraceEvent kỳ vọng (không ts tuyệt đối, dùng t tương đối)
├── expected.writes.json    # [{t: 3000, path: Vehicle.Body.Lights.Hazard.IsSignaling, value: true}]
└── cpp/…                   # snapshot generated (ở repo compiler-code-cpp: test/golden/GW-A/)
```
Mọi module dùng chung fixture qua package contracts ⇒ không lệch.

## 3. Parity: so sánh gì
- Chuẩn hoá trace: bỏ `ts` tuyệt đối, dùng `t` (ms từ đầu scenario) làm tròn theo lưới 10 ms; so **chuỗi (t, node, ev, value)** và **writes**.
- Dung sai: timer ±20 ms trên binary thật (không phải virtual) — so với lưới; float so với epsilon 1e-5.

## 4. CI gates
| Gate | Điều kiện merge |
|---|---|
| PR (module) | lint + unit + contract + golden + determinism + license scan + `contract-only-deps` |
| PR (meta-repo bump lock) | lock-verify + compose up + smoke GW-A (Simulate + SynCode + 10 s run) |
| Nightly | compile + integration + parity + E2E + perf |
| Release | Nightly xanh 3 ngày liên tiếp + checklist [13 §5](13-implementation-roadmap.md#5-định-nghĩa-product-ready-v10-exit-m11) |

## 5. Security checklist
- [ ] Workspace: mọi path resolve realpath nằm trong `/workspace/projects/<slug>`; từ chối `..`, symlink ra ngoài, tên file chứa ký tự điều khiển; chỉ ghi `ownedRoots` + AppManifest merge.
- [ ] Không ghi `.velocitas.json` sau init; không ghi file có header "maintained by velocitas CLI".
- [ ] Compiler giới hạn kích thước graph/expr (DoS); expr không eval.
- [ ] Codegen escape mọi chuỗi người dùng (`cppString`, `pyString`); identifier sanitize; fuzz test (property-based) cho tên block/giá trị string.
- [ ] Service nội bộ không publish port; studio BFF kiểm auth + ownership project trên mọi route `/api/sv/*`.
- [ ] Signal inject chỉ khi run dev và path thuộc catalog.
- [ ] MCP server yêu cầu bearer token; action có side-effect cần scope.
- [ ] Secrets chỉ qua env; không log API key; `.env` trong `.gitignore`.
- [ ] Container non-root, `cap_drop: ALL`, `no-new-privileges`; codegen/compiler `read_only`.
- [ ] Dependency scan (osv-scanner) + license scan (không AGPL/Sim-EE/MS-proprietary).
