# 15 — Risk Register & Open Questions

> Kế thừa R1–R10 của Master Plan v2 và bổ sung từ research. Cập nhật mỗi cuối milestone.

## 1. Risk register
| ID | Rủi ro | Xác suất | Ảnh hưởng | Giảm thiểu | Owner milestone |
|---|---|---|---|---|---|
| R1 | Coupling executor Sim | TB | Cao | Không dùng executor Sim cho vehicle ([ADR-0006](adr/ADR-0006-compile-first-execution-model.md)) | M4 |
| R2 | VSS đổi giữa thiết kế và build | TB | TB | `modelHash` + `MODEL_HASH_MISMATCH`; pin release per project | M2 |
| R3 | SDK C++ đổi API | TB | Cao | Runtime cô lập SDK; pin SDK 0.7.1; conformance test | M6 |
| R4 | Race callback/timer | Cao (nếu viết tay) | Cao | Strand 1 thread + runtime test | M6 |
| R5 | code-server proxy/auth | TB | TB | Port riêng MVP; proxy P2 | M9 |
| R6 | Bùng nổ độ phức tạp services | TB | TB | Services để M14 | M14 |
| R7 | Lệch semantics giữa backends/simulator | Cao | Cao | Parity + conformance chung | M11 |
| R8 | Dọn Sim phá dữ liệu | Thấp | TB | Flag trước, xoá M11; migration không drop bảng | M1/M11 |
| R9 | Upstream Sim drift | Cao | Thấp | Pin v0.7.13, không auto-sync ([ADR-0003](adr/ADR-0003-upstream-baseline-and-fork-policy.md)) | — |
| R10 | AppManifest version mới | Thấp | TB | Handler versioned | M7 |
| **R11** | `apps/sim/ee` license lẫn vào sản phẩm | Cao nếu bỏ qua | **Rất cao (pháp lý)** | Gỡ ở M1 + license scan CI | M1 |
| **R12** | Copy nhầm code Scratch (AGPL) | TB | Rất cao | Clean-room policy, review, scan tên opcode Scratch | M3 |
| **R13** | `sdv.databroker.v1` bị gỡ ở databroker mới | TB | Cao | Pin 0.5.0; kế hoạch v2 + provider ở M14; runtime ẩn API | M8/M14 |
| **R14** | Velocitas CLI cần internet/GitHub token khi init (rate limit) | Cao | TB | Bake cache vào image; `VELOCITAS_OFFLINE=1`; `GITHUB_API_TOKEN` chỉ lúc build image | M0/M7 |
| **R15** | Image toolchain rất lớn (vài GB), build lâu | Cao | TB | Build 1 lần, publish registry nội bộ; cache layer; ccache volume | M7 |
| **R16** | Microsoft extension license trong code-server | TB | TB | Chỉ dùng Open VSX (clangd…) | M9 |
| **R17** | Tên "SimVehicleApp" gần trademark "Sim" | TB | TB | Pháp chế kiểm tra; tên có thể cấu hình ở 1 chỗ (`brand.ts`) | M1 |
| **R18** | Velocitas dự án ít hoạt động (commit thưa 2025–2026) | TB | TB | Runtime cô lập; toolchain có thể chuyển sang build Conan/CMake trực tiếp nếu CLI ngừng hỗ trợ | M7 |
| **R19** | Rust không có SDK Velocitas | Chắc chắn | TB | kuksa-rust-sdk + template riêng; feasibility trước | M13 |
| **R20** | LLM sinh patch sai / hallucinate path | Cao | Thấp | Tool bắt buộc tra catalog + validate trước khi hiển thị; user duyệt | M10 |
| **R21** | Một databroker dùng chung → run chồng nhau | TB | TB | 1 run/stack MVP; per-run stack M14 | M8 |

## 2. Open questions (cần PO/lead trả lời — mặc định đề xuất trong ngoặc)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Multi-user ngay v1.0 hay single-team? | Single-team, auth bật, 1 runtime stack dùng chung |
| Q2 | VSS mặc định v4.0 (khớp template) hay v5/v6? | v4.0; cho chọn v4.x; v5+ sau khi model generator hỗ trợ |
| Q3 | Mô hình license thương mại (per-seat, per-export…)? | Hook sẵn, enforce sau |
| Q4 | Có cần deploy lên thiết bị thật (Kanto) trong v1? | Không (M14+) |
| Q5 | Registry image nội bộ (ghcr/Harbor)? | ghcr.io của org |
| Q6 | Tên sản phẩm cuối cùng | "SimVehicleApp" cấu hình được |
| Q7 | Cho phép AI tự apply vào draft? | Tắt mặc định |
| Q8 | Ngôn ngữ UI (VI/EN)? | **Đã kiểm M01-T12 (2026-10-03):** Sim v0.7.13 không có framework i18n, UI hard-code EN ⇒ EN mặc định cho MVP; chuỗi SimVehicleApp gom vào config; tiếng Việt cần ADR riêng (M11+/M14). [Report](../docs/reports/M01-T12-i18n.md) |
