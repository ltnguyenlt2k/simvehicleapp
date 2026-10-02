# Module: `velocitas-stack`

**Tầng:** L5 · **ADR:** 0024, 0025 · **Milestone:** M0 (spike), M7, M8, M12
**Containers:** `toolchain-cpp` :4210, `toolchain-python` :4220, `databroker` :55555, `mqtt` :1883/9001, `mock-provider`

## Trách nhiệm
Mọi thứ "Velocitas": template vendored (pin SHA), toolchain image thay devcontainer, toolchain agent (build/test/run), cấu hình runtime stack (databroker, mosquitto, mock). **Không biết** workflow/IR.

## Cấu trúc
```
templates/
  vehicle-app-cpp-template/      # snapshot @275e858 (+ UPSTREAM.md: SHA, ngày, LICENSE/NOTICE giữ nguyên)
  vehicle-app-python-template/   # snapshot @e7082f7
  update.sh                      # cập nhật snapshot theo lock (review thủ công)
toolchain/
  cpp/Dockerfile   python/Dockerfile   seed/ (script bake cache)
agent/                           # toolchain-agent (TS → bun compile): jobs, process supervisor, SSE, templates endpoint
runtime/
  databroker/ (README: flags, vss mount)   mosquitto/mosquitto.conf   mock/mock.py
test/
  offline-build.sh  run-sample.sh  agent contract tests
```
## Toolchain API v1
`POST /jobs` · `GET /jobs/:id` · `GET /jobs/:id/stream` (SSE) · `POST /jobs/:id/cancel` · `GET /templates?lang=` · `/healthz` · `/version` (gồm velocitas CLI version, SDK version, conan version, template SHA).

## Kiểm thử
S-1/S-2 thành test tự động: build template offline; chạy sample app với databroker compose; agent contract tests; image size budget (cảnh báo > 6 GB).
