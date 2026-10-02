# M7 — Workspace service, Toolchain agent, SynCode end-to-end

**Mục tiêu:** Bấm **SynCode** → IR → C++ → ghi atomic vào Velocitas project → build → test → UI hiển thị verification + link IDE (link hoạt động ở M9).
**ADR:** 0023, 0025, 0026 · **Phụ thuộc:** M6, M7a (toolchain image từ M0) · Master Plan Phase 16–20

## A. velocitas-stack (M7a có thể bắt đầu từ M0)
| ID | Task | Test |
|---|---|---|
| M07-T01 | Vendor template C++ @275e858 vào `templates/` + UPSTREAM.md | license check |
| M07-T02 | `toolchain/cpp/Dockerfile` hoàn chỉnh theo S-1 (tools, seed cache Debug+Release, vehicle model VSS 4.0) | build image; offline build test |
| M07-T03 | toolchain-agent: jobs init/deps/build/test/format-check/run/stop/generate-model; queue; SSE; cancel | contract tests |
| M07-T04 | `GET /templates?lang=cpp` (tar template) | |
| M07-T05 | Phát hiện AppManifest VSS src đổi ⇒ tự `generate-model` trước build | test đổi release |

## B. workspace (orchestrator repo)
| ID | Task | Test |
|---|---|---|
| M07-T06 | Path policy (normalize, realpath, symlink, ownedRoots) | security tests |
| M07-T07 | Init project: template + overlay + runtime → staging → rename; `.simvehicleapp/project.json` | |
| M07-T08 | Commit atomic (staging, swap, journal, recovery on boot), Generation Manifest, backup | fault injection |
| M07-T09 | AppManifest merge v3 (ADR-0023) + managed tracking | idempotency test |
| M07-T10 | `GENERATED_FILE_MODIFIED` detection | |
| M07-T11 | Rollback 10 generation gần nhất | |

## C. orchestrator
| ID | Task | Test |
|---|---|---|
| M07-T12 | Schema `sv` (project, project_workflow, generation, generation_stage, job, run, run_event) — Drizzle, migration chạy trong `migrations` service | migration test |
| M07-T13 | Project API (tạo project: slug, appName, language, vssRelease) | |
| M07-T14 | GenerationPipeline stages + job queue + SSE `/events` | pipeline test với fake backend/toolchain |
| M07-T15 | Error mapping: parse `file:line` GCC/Clang → sourcemap → `CPP_COMPILE_ERROR{blockId}`; Conan lỗi → `DEPS_INSTALL_FAILED` | fixture log |
| M07-T16 | Response dạng Master Plan Appendix A/B | contract |

## D. studio
| ID | Task | Test |
|---|---|---|
| M07-T17 | Project page (list/create; gán workflow vào project; chọn language/VSS) | |
| M07-T18 | Nút SynCode (cạnh Run/Debug/Delete) + progress theo stage (SSE) + Build log tab + kết quả verification + diagnostics map về block | Playwright (mock backend) cả pass/fail |
| M07-T19 | Generated files viewer (read-only tree + diff với generation trước) | |

## Gate
- GW-A và GW-B: SynCode pass `{ir, format, compile, tests}` bằng toolchain thật (Master Plan Phase 15/19 gate).
- SynCode lần 2 không đổi gì ⇒ không file nào đổi (idempotent), build incremental < 60 s.
- Kill workspace giữa commit ⇒ project không half-written.
- Lỗi compile cố ý (runtime API mismatch giả) ⇒ diagnostic trỏ đúng block.
