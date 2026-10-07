# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/); phiên bản theo SemVer. Chi tiết từng milestone:
[docs/reports/](docs/reports/), trạng thái: [docs/ROADMAP.md](docs/ROADMAP.md).

## [1.0.0-rc.1] — chưa phát hành

Ứng viên v1.0 (MVP = M0→M11). Phát hành thật (tách repo, tag, lock, image) chờ PO xác nhận — `scripts/release-split.sh`.

### Thêm mới
- **Studio** (fork Sim v0.7.13, Apache-2.0): canvas khối xe từ catalog VSS (v4.0, v4.2), 36 khối (trigger, sensor/actuator,
  logic, flow, state, comm), lint realtime + Problems, Simulation (scenario, timeline, replay), Vehicle projects, SynCode
  với Build log và Generated files, Run/Stop trên KUKSA thật, Run console, Signals (inject, record ⇒ scenario), badge trace
  live, Open IDE (code-server), Export zip, nhập lại workflow, trợ lý AI (đề xuất WorkflowPatch hiển thị dạng diff, xác
  nhận hành động), System status.
- **Core:** VSS catalog, compiler tất định Graph → IR (diagnostics công khai, kiểu/đơn vị), simulator (P2).
- **compiler-code-cpp:** generator C++ tất định + runtime (ngữ nghĩa ADR-0012), test sinh từ scenario, conformance P1.
- **Orchestrator:** workspace (ghi atomic, export tất định), pipeline SynCode, RunManager + TraceIngest, signal-gateway
  (kuksa.val.v1, scenario player), EntitlementService (license Ed25519 `full`/`enforce`), `/metrics`, `/system`.
- **AI (`simvehicleapp-ai`):** provider anthropic/openai/openai-compatible/ollama/gemini/`fake`, 13 tool, MCP server/client,
  store `sv_ai`, cổng license `ai.assistant`.
- **Vận hành:** Docker Compose (cổng chỉ 127.0.0.1), `scripts/sv`, `scripts/bootstrap.sh`, refresh từ CI, parity P3,
  benchmark NFR-02, osv-scanner + license scan trong CI.

### Đã biết / chờ quyết định
- Eval trợ lý AI ≥ 80 % chưa đạt ổn định trên model local 9B (65–80 %) — đo lại với provider cloud.
- Dọn Sim đợt 3b (block AI lõi, hạ tầng OAuth tích hợp, nâng dependency lõi có lỗ hổng) — ADR-0008 Notes.
- Usability test 5 người (M11-T09) cần người tham gia thật.
