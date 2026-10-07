# Báo cáo khả thi — backend Rust (M13, ADR-0041)

> Ngày: 2026-10-07 · Người/agent: Claude Code · Trạng thái: **đề xuất Go (giữ nhãn "experimental")** — quyết định
> Go/No-go là của PO; ghi theo uỷ quyền PO 2026-10-06, **chờ PO xác nhận**.

## 1. Câu hỏi
Có làm được backend Rust ngang hàng C++/Python (cùng ngữ nghĩa simulator, chạy trên KUKSA thật) dù Velocitas không có
template/SDK Rust, chỉ dựa `eclipse-kuksa/kuksa-rust-sdk` 0.2.2 (Apache-2.0)?

## 2. Đã làm
| Phần | Cách làm | Bằng chứng |
|---|---|---|
| Template | `velocitas-stack/templates/vehicle-app-rust-template` (của SimVehicleApp): Cargo workspace, crate `app`, AppManifest v3, `.velocitas.json` tối thiểu; thư mục SynCode sở hữu để trống (`build.rs` trỏ crate vào code sinh khi có) | `templateSha` = git tree id (CI kiểm) |
| Runtime | crate `simvehicleapp-runtime`: port runtime C++/Python (strand (t, seq), fiber, policy, trace `SVTRACE` cùng định dạng), `values` = ngữ nghĩa `values.ts`; feature `host` = tokio current-thread + `kuksa-rust-sdk` (stub `sdv.databroker.v1` trên một tonic channel) + `rumqttc` | unit test, clippy `-D warnings`, rustfmt (CI) |
| Generator | `compiler-code-rust` :4130 — `bind(&Runtime)` + closure, `#[rustfmt::skip]` (bố cục do generator, như `DisableFormat` của C++); test sinh ra = test target với harness riêng in dòng kiểu gtest | golden GW-A..G diff 0, tất định, fuzz chuỗi |
| Toolchain | `toolchain-rust` (rust 1.98.1, cmake/g++ cho protoc, rustfmt/clippy): crate vendor offline, target dir dùng chung đã "ấm", build job chép binary vào `build/bin/app` | build seed offline trong image |
| Tích hợp | profile `rust`, `SV_BACKENDS`/`SV_TOOLCHAINS`; agent plan Rust; trang Projects hiện "Rust (experimental)" khi backend + toolchain chạy; export README/notice Rust | — |

## 3. Kết quả đo (stack dev, máy WSL 11 GB)
| Tiêu chí | C++ | Python | **Rust** |
|---|---|---|---|
| Opcode hỗ trợ | 24/24 | 24/24 | **24/24** |
| Conformance P1 (38 C + 7 golden + fuzz) | 46/46 | 46/46 | **46/46** |
| Parity P3 trên KUKSA (7 golden) | 7/7, lệch ≤ 14 ms | 7/7, ≤ 3 ms | **7/7, ≤ 2 ms** |
| SynCode (trung vị, project đã ấm) | 4,9 s | 0,7 s | **20,6 s** (cargo build release, LTO) |
| Binary app | 52,6 MB (debug) | — (Python + deps) | **3,0 MB** (release, strip) |
| Image toolchain | 3,72 GB | 2,14 GB | **2,31 GB** |
| Runtime (dòng mã) | 3 773 | 2 403 | **3 948** |
| Build lạnh dependency (image) | Conan ~ phút | pip | ~2 phút `-j2` (protoc từ mã nguồn) |

Bằng chứng: [parity Rust](../reports/evidence/M13-parity-p3-rust-local.json), [parity Python](../reports/evidence/M12-parity-p3-python-local.json),
[parity C++](../reports/evidence/M12-parity-p3-cpp-regression-local.json); live GW-A: Speed 100 ⇒ hazard tắt (crosses below),
130 giữ 2 s ⇒ hazard bật + MQTT HMI, SIGTERM ⇒ `app.stopping`.

**License dependency** (`cargo metadata --locked`, 138 crate): toàn bộ giấy phép dễ dãi — MIT/Apache-2.0 (đa số), BSD-3-Clause,
ISC, Zlib, Unicode-3.0, Unlicense OR MIT; `r-efi` là "MIT OR Apache-2.0 OR LGPL-2.1-or-later" (chọn MIT/Apache-2.0). Không
GPL/AGPL bắt buộc.

## 4. Rủi ro
1. **Không có tooling Velocitas cho Rust**: không `velocitas init`, không runtime-local/Kanto, không model sinh từ VSS
   (Rust dùng VSS path; kiểm kiểu bằng `sv-check-signals` lúc build). Template do SimVehicleApp bảo trì.
2. **`kuksa-rust-sdk` còn trẻ (0.2.x)**: API có thể đổi; chỉ dùng stub proto `sdv.databroker.v1` nó sinh ra (ít bề mặt).
   `kuksa.val.v2` (M14 #5) sẽ cần provider như C++/Python.
3. **Build nặng hơn**: protoc biên dịch từ mã nguồn (`protobuf-src`), SynCode ~20 s (gấp ~4 lần C++); máy ít RAM phải
   `-j2`. Giảm được bằng protoc dựng sẵn hoặc sccache.
4. **Chưa có IDE Rust** (`ide-rust`, rust-analyzer) và chưa có mã diagnostic riêng cho lỗi biên dịch Rust (lỗi build
   báo BUILD_FAILED chung; C++ có CPP_COMPILE_ERROR gán về block).
5. **`#[rustfmt::skip]`** trên code sinh: rustfmt không kiểm bố cục code sinh (như C++); Python thì kiểm thật.

## 5. Đề xuất
**Go — giữ nhãn "experimental"**: ngữ nghĩa đã chứng minh ngang C++/Python (46/46, parity 7/7), binary nhỏ nhất,
tích hợp không cần sửa core. Trước khi bỏ nhãn: ide-rust, diagnostic lỗi biên dịch Rust gán về block, giảm thời gian
build (protoc sẵn), theo dõi phiên bản `kuksa-rust-sdk`. **Chờ PO quyết.**
