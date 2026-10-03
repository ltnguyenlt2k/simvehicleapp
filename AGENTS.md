# AGENTS.md — Quy tắc cho AI coding agent trong meta-repo SimVehicleApp

> File này áp dụng cho mọi agent (Claude Code, Codex, Cursor…). `CLAUDE.md` trỏ về đây. Mỗi repo con có `AGENTS.md` riêng bổ sung quy tắc local.

## 1. Đọc gì trước khi code
Đọc nền một lần mỗi phiên; lần sau chỉ đọc lại phần đã đổi hoặc chưa có trong context. Dùng `rg` để lấy đúng mục/task, không nạp toàn `analysis/` hay tất cả skill. Với sửa prose/skill thuần, đọc tài liệu liên quan; không chạy build sản phẩm.
1. [analysis/README.md](analysis/README.md) — bản đồ tài liệu.
2. [analysis/00-research-findings.md](analysis/00-research-findings.md) — dữ kiện đã verify + **bảng pin version** (không đoán version).
3. [analysis/02-layers-and-modules.md](analysis/02-layers-and-modules.md) — tầng, repo con, ma trận phụ thuộc.
4. ADR của milestone đang làm: [analysis/adr/README.md](analysis/adr/README.md).
5. File phase: [analysis/phases/](analysis/phases/README.md) — làm **đúng thứ tự task**, đúng gate.
6. [docs/ROADMAP.md](docs/ROADMAP.md) — **bảng tracking sống**: trước khi làm 1 feature, kiểm trạng thái hiện tại ở đây; làm xong phải tự cập nhật (xem skill `simvehicleapp-phase-execution` + mục 1 của file).
`vehicle_no_code_studio_master_plan_v2.md` là tài liệu gốc; khi mâu thuẫn, **analysis/ + ADR thắng** (đã hiệu chỉnh theo research 2026-09-30); khi analysis mâu thuẫn source thật ⇒ source thật thắng + ghi ADR.

## 2. Luật cứng (vi phạm = revert)
1. **Không LLM trong đường sinh code** (Graph → IR → source). AI chỉ ở `simvehicleapp-ai` và chỉ đề xuất WorkflowPatch.
2. **Không import code chéo module** (`modules/<m>`); chỉ phụ thuộc `simvehicleapp-contracts`. Giao tiếp qua HTTP/SSE/WS theo contract. Build context của module không được trỏ ra ngoài thư mục module.
3. **Chỉ `workspace` service ghi source** vào `/workspace/projects/**`. Codegen trả file set, không ghi đĩa.
4. **Không code/asset từ Scratch** (AGPL) và **không code từ `apps/sim/ee/`** (Sim Enterprise License). Không cài `ms-vscode.cpptools`/Pylance trong code-server.
5. **Tất định**: cùng input ⇒ cùng bytes (không timestamp/random trong IR hoặc file sinh ra).
6. **Không sửa** `.velocitas.json` sau init, không sửa file có header "maintained by velocitas CLI", không ghi ngoài `ownedRoots`.
7. **Không bỏ qua gate**: milestone N+1 không bắt đầu khi gate N FAIL.
8. **Mã diagnostic là API công khai**: không đổi tên/xoá.
9. **Mọi thay đổi contract/kiến trúc ⇒ ADR** (skill `adr-writing`).
10. **Docker Compose là mode chạy duy nhất**; không mount `/var/run/docker.sock`; port bind `127.0.0.1`.

## 3. Skills dùng chung cho Codex / Claude

Nguồn duy nhất: `.claude/skills/<name>/SKILL.md`. Codex discovery qua `.agents/skills/<name>` symlink tới cùng folder; không duy trì bản copy trong `.codex/skills` hay cài global. Skill tự chọn theo description hoặc gọi `$simvehicleapp-phase-execution`, `$add-vehicle-block`, v.v. Nếu phiên chưa thấy skill mới, mở phiên mới; vẫn có thể đọc đường dẫn nguồn trực tiếp.

Chỉ tải skill áp dụng: mọi task milestone/code dùng `simvehicleapp-phase-execution`; thêm skill domain khi cần. Không tự tải mọi skill được nhắc trong một skill khác. Path/lệnh trong skill phải đối chiếu source thật trước khi dùng.
| Skill | Dùng khi |
|---|---|
| `simvehicleapp-phase-execution` | Bắt đầu/kết thúc milestone/task **và** viết code thật cho task đó (vòng lặp research→test→implement→mismatch→track) |
| `multi-repo-modules` | Ranh giới module dev; submodule/lock chỉ khi release (ADR-0009) |
| `upstream-verify` | Trước khi dùng version/API của Sim, Velocitas, KUKSA, VSS, code-server, MCP |
| `sim-fork-refactor` | Sửa `simvehicleapp-studio` (fork Sim v0.7.13) |
| `vss-signals` | Làm việc với VSS catalog, path, datatype, unit |
| `add-vehicle-block` | Thêm/sửa block (BlockSpec + BlockConfig + simulator + lowering + test) |
| `ir-compiler-diagnostics` | Compiler stages, IR, expression, type/unit, diagnostics |
| `velocitas-vehicle-app` | Hiểu/sinh code Velocitas (SDK C++/Python, AppManifest, CLI, runtime) |
| `backend-plugin` | Làm `compiler-code-<lang>` (generator + runtime) |
| `golden-and-parity-tests` | Golden snapshot, conformance, parity |
| `docker-compose-stack` | Compose, toolchain image, runtime stack, bootstrap |
| `ai-assistant-mcp` | Chat, providers, MCP tools, WorkflowPatch |
| `license-compliance` | Thêm dependency, file upstream, export |
| `adr-writing` | Viết/cập nhật ADR |

## 4. Quy trình mỗi task
Vòng lặp chi tiết (review doc → research → implement → mismatch → đồng bộ doc → test → sửa lỗi, checklist production-ready, tracking): skill `simvehicleapp-phase-execution`. Tóm tắt:
1. Đọc task trong phase file → ADR liên quan → CONTRACT.md của module.
2. Viết test trước (unit/golden/contract) khi có thể.
3. Implement trong đúng module (branch `feat/M<nn>-T<nn>-<slug>` khi cần); dev hiện là một repo theo ADR-0009.
4. Chạy test module + contract test; nếu chạm contract → bump + ADR.
5. Dev: một diff/PR trong repo hiện tại. Release mới dùng PR repo con và bump lock sau merge; kiểm script tồn tại. Không tự commit/push/merge nếu chưa được yêu cầu.
6. Cập nhật checklist DoD của phase **và** trạng thái feature trong [docs/ROADMAP.md](docs/ROADMAP.md) (`☐`→`🔄` lúc bắt đầu, `🔄`→`✔` kèm bằng chứng lúc xong).

### Commit / PR identity
Mọi commit/PR chỉ đứng tên user: không thêm `Co-Authored-By` cho AI, footer "Generated with Claude Code" hoặc attribution AI tương tự, kể cả Codex. Khi được yêu cầu commit, kiểm author/committer đúng identity của user; chưa chắc thì không tạo commit. Quy tắc này dùng chung cho mọi agent (đồng bộ với commit `b957cb1` trong `CLAUDE.md`).

### Giảm credit nhưng giữ mục tiêu cuối
- Tái dùng context và bằng chứng đúng SHA/digest; upstream thiếu bằng chứng hoặc thông tin động mới tra nguồn chính thức. Không mặc định kiểm latest/nâng version.
- Search/read có scope, output giới hạn; gộp thao tác độc lập, không đọc lại log dài. Không tự dùng agent phụ, LLM live hay eval trả phí cho task thông thường.
- Test/module build liên quan và mọi gate bắt buộc vẫn phải chạy. Check đã PASS chỉ chạy lại khi input đổi hoặc có nghi ngờ cụ thể; full-stack smoke/parity theo phase và phạm vi ảnh hưởng.
- Sửa mismatch nội bộ tự quyết + đồng bộ doc; không mở refactor ngoài task. Báo check chưa chạy/FAIL trung thực, không tự đánh Accepted cho ADR hay PASS cho gate thiếu bằng chứng.
- Kết thúc khi kết quả được yêu cầu đã có và check bắt buộc PASS; không lặp review/research/test chỉ để có thêm vòng kiểm tra. Nếu chặn, nêu bằng chứng và việc còn thiếu.

## 5. Lệnh thường dùng (dev phase — ADR-0009)
```bash
cp .env.example .env                 # chỉnh port nếu trùng
scripts/sv build                     # build image theo thứ tự (devcontainer → toolchain → ide → …)
scripts/sv up                        # docker compose up -d (root docker-compose.yml include các module)
scripts/sv smoke                     # M0 smoke: project offline → build → run app ↔ databroker/MQTT
docker compose -f modules/<m>/compose.yaml config -q   # module phải valid độc lập
```
Bằng chứng/giới hạn môi trường Velocitas: `docs/spikes/M0-spikes-report.md`, pin: `docs/BASELINE.md`.
