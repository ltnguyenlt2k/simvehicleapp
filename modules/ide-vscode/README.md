# ide-vscode (L6 — Developer Tools)

`ide-cpp` = `simvehicleapp/toolchain-cpp:dev` (identical Velocitas env) + code-server 4.139.1 + Open VSX extensions
(clangd, cmake-tools, clang-format, vsmqtt, mermaid, gdb debug). No `ms-vscode.cpptools`/Pylance (license).

```bash
docker compose build toolchain-cpp && docker compose -f modules/ide-vscode/compose.yaml up -d   # standalone
open http://localhost:${SV_IDE_PORT:-8080}/?folder=/workspace/projects/demo
```
clangd uses `build/compile_commands.json` (exported by the Velocitas build-system). Verified: `clangd --check` → 0 errors.
