# M9 — IDE (code-server), Export/Download, License hooks

**Mục tiêu:** Open IDE mở đúng project với môi trường Velocitas đầy đủ; tải project về như template tuỳ biến; mọi điểm chặn license đã gắn.
**ADR:** 0028, 0031 · **Phụ thuộc:** M7 · Master Plan Phase 21

## Tasks
| ID | Task | Module | Test |
|---|---|---|---|
| M09-T01 | `ide-vscode/cpp/Dockerfile` FROM toolchain-cpp + code-server 4.139.1 + extensions whitelist | ide-vscode | smoke |
| M09-T02 | settings/tasks/launch overlay; clangd compile_commands | ide-vscode | build task chạy |
| M09-T03 | Compose `ide-cpp` (volumes chung, password) + bootstrap build order | meta | |
| M09-T04 | `editor.url` trong response SynCode; nút Open IDE | orchestrator/studio | E2E: mở URL thấy file generated |
| M09-T05 | Cảnh báo khi IDE chạy app song song Live Run (phát hiện kết nối databroker lạ — P2 đơn giản: hướng dẫn UI) | studio | |
| M09-T06 | Export zip (workspace stream, `.svexportignore`, `.simvehicleapp/*`, README.SIMVEHICLE.md, NOTICE, THIRD-PARTY-NOTICES) | orchestrator | unzip + build bằng `app/Dockerfile` template trên máy sạch |
| M09-T07 | EntitlementService + license schema + `SV_LICENSE_MODE=full` + log quyết định; gắn vào export/IDE/SynCode/language/AI | orchestrator | unit PDP |
| M09-T08 | Import lại project từ `.simvehicleapp/workflows/*.graph.json` (round-trip) | studio | |

## Gate
Open IDE → task Build xanh → Run on stack kết nối databroker; export GW-A build thành công ngoài SimVehicleApp (Dockerfile template) ; PDP chặn đúng khi thử license restricted.
