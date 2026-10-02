# Module: `ide-vscode`

**Tầng:** L6 · **ADR:** 0028 · **Milestone:** M9 (cpp), M12 (python)
**Containers:** `ide-cpp` :8080, `ide-python` :8081

## Cấu trúc
```
cpp/Dockerfile        # ARG TOOLCHAIN_IMAGE; FROM ${TOOLCHAIN_IMAGE}; + code-server 4.139.1
python/Dockerfile
extensions/cpp.txt  extensions/python.txt     # whitelist Open VSX (có cột license trong README)
settings/
  settings.json       # clangd args, files.readonlyInclude generated/**, terminal zsh
  tasks.json          # SimVehicleApp: Build / Test / Run on stack / Databroker CLI
  launch.json         # gdb attach/launch build/bin/app với env stack
entrypoint.sh         # copy settings vào user data lần đầu; exec code-server --bind-addr 0.0.0.0:8080 --auth password /workspace/projects
test/ smoke.sh        # healthz code-server, extension list, task build chạy được
```
## Ranh giới
Không có API cho studio gọi; chỉ URL. Không chứa toolchain riêng (luôn FROM toolchain image của velocitas-stack ⇒ cùng version).
