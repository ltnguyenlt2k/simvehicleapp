# Modules — đặc tả từng repo con

> Mỗi file mô tả một repo con độc lập: trách nhiệm, cấu trúc thư mục, contract cung cấp/tiêu thụ, container, cấu hình, test, milestone liên quan.
> Tổng quan tầng & ma trận phụ thuộc: [02-layers-and-modules](../02-layers-and-modules.md).

| Repo | Tầng | File |
|---|---|---|
| simvehicleapp (meta) | infra | [simvehicleapp-meta.md](simvehicleapp-meta.md) |
| simvehicleapp-contracts | shared | [simvehicleapp-contracts.md](simvehicleapp-contracts.md) |
| simvehicleapp-studio | L1 | [simvehicleapp-studio.md](simvehicleapp-studio.md) |
| simvehicleapp-core | L3 | [simvehicleapp-core.md](simvehicleapp-core.md) |
| simvehicleapp-orchestrator | L2 | [simvehicleapp-orchestrator.md](simvehicleapp-orchestrator.md) |
| simvehicleapp-ai | L2 | [simvehicleapp-ai.md](simvehicleapp-ai.md) |
| compiler-code-cpp / -python / -rust | L4 | [compiler-code.md](compiler-code.md) |
| velocitas-stack | L5 | [velocitas-stack.md](velocitas-stack.md) |
| ide-vscode | L6 | [ide-vscode.md](ide-vscode.md) |

## Template chung cho mọi repo con
```
<repo>/
├── README.md            # mục đích, chạy standalone, chạy trong hệ thống
├── CONTRACT.md          # cung cấp: API/schema@version · tiêu thụ: API/schema@range · ADR liên quan
├── AGENTS.md            # quy tắc cho AI agent trong repo này (+ CLAUDE.md → @AGENTS.md)
├── CHANGELOG.md  LICENSE  NOTICE  VERSION
├── Dockerfile           # nếu là service; HEALTHCHECK /healthz
├── .github/workflows/ci.yml   # lint · test · contract · license · image
└── src/ | services/ | packages/ | test/
```
