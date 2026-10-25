# M21 — Hoàn tất roadmap (PO chấp thuận toàn bộ 2026-10-25)

> PO 2026-10-25: "tôi accept hết, hãy thực hiện cho hoàn thành roadmap; vấn đề nào chưa giải quyết hãy tìm hiểu, phân tích thật kỹ, đưa ra giải pháp tối ưu nhất và tự quyết định luôn".
> Hệ quả: 36 ADR còn Proposed ⇒ **Accepted** (analysis/adr/README.md); mọi mục "chờ PO" được giải quyết theo bảng dưới. Quyết định ở đây là của agent theo uỷ quyền này; lý do ghi kèm để PO soát lại sau.

## 1. Hiện trạng các mục còn mở (2026-10-25)
| Mục | Milestone | Vướng ở đâu |
|---|---|---|
| Gate + full luồng `@live` + video + báo cáo WASM | M20-T09 | đang chạy `m20-wasm-live @live` |
| Parity P3 + E2E nightly "xanh 3 đêm liên tiếp" | M11-T01/T02 | lịch sử nightly xen kẽ xanh/đỏ; hai lỗi gốc sửa 2026-10-25 (`64f849cd`, `5d5f4413`) |
| Cleanup Sim đợt 3b (block AI lõi, OAuth tích hợp, nâng major) | M11-T03 | chờ PO |
| Security: osv studio còn 19 gói | M11-T06 | đi cùng đợt 3b |
| Docs đầy đủ | M11-T08 | chờ PO review |
| Usability test 5 người | M11-T09 | cần người thật |
| Release v1.0.0 (split repo, tag, image) | M11-T10 | hành động ra ngoài, chờ PO |
| Eval trợ lý soạn test với model thật | M18-T06 | endpoint PO lỗi (500) |
| M14 #2 gRPC, #3 standalone, #4 per-run/multi-user, #5 databroker ≥ 0.7, #6 Quick Run, #7 sub-workflow + `sv_rate`, #8 Kanto, #9 IDE proxy + SSO | M14 | hoãn chờ PO |
| Ma trận E2E, video, ký video | M15-T01/T09/T10 | chờ PO |
| Chấp thuận ADR M16–M20 | M16–M20 | chờ PO ⇒ đã Accepted 2026-10-25 |

## 2. Phân tích và quyết định
| # | Mục | Quyết định | Lý do |
|---|---|---|---|
| D1 | Nightly 3 đêm | Giữ tiêu chí. Tick khi có **3 nightly theo lịch liên tiếp xanh** sau `5d5f4413`; đêm đỏ ⇒ sửa gốc, đếm lại. | Tiêu chí đo độ ổn định; không có cách rút ngắn trung thực. |
| D2 | Cleanup đợt 3b | **Làm**, theo lô nhỏ, mỗi lô CI xanh: gỡ block AI lõi của Sim (agent/LLM/router/evaluator…) không dùng trong luồng vehicle, gỡ hạ tầng OAuth tích hợp đã mồ côi, rồi nâng major còn lại. | Định nghĩa v1.0 (13 §5) đòi "không còn block AI"; mỗi gói bỏ đi là bớt CVE (D3). |
| D3 | osv studio | Đi cùng D2; gói còn lại không nâng được ⇒ ghi lý do + mức ảnh hưởng (không đến được từ đường chạy). | |
| D4 | Docs | PO đã chấp thuận ⇒ ✔; rà link chết một lượt trước release. | |
| D5 | Usability 5 người | Agent không tuyển được người thật. **Thay thế:** cognitive walkthrough theo tutorial (từng bước: người mới thấy gì, cần biết gì, lỗi dễ gặp) + số đo E2E tutorial; ghi rõ "chưa phải test với người thật", đề xuất làm sau release. | Trung thực hơn tick ✔ giả; vẫn cho ra danh sách việc sửa UX. |
| D6 | Release v1.0.0 | Phát hành từ **monorepo** hiện tại: tag `v1.0.0` + GitHub Release (CHANGELOG, image dựng sẵn qua `release-images.yml`), đẩy cả origin lẫn mirror. **Không** tách 10 repo con ở v1.0; `release-split.sh` giữ lại cho khi có người bảo trì từng module. ADR mới ghi quyết định (thay phần release của ADR-0002). | Một người bảo trì; tách repo nhân đôi CI/lock mà không có người dùng cần nó; ADR-0009 đã dev một repo và chạy tốt. |
| D7 | Eval M18-T06 | Thử lại endpoint của PO; vẫn lỗi ⇒ đóng tính năng dựa trên test với fake provider + E2E, ghi eval model thật là việc của PO khi endpoint sẵn sàng (lệnh `eval/tests-eval.ts`). | Không có endpoint thì không có số đo thật; không giả kết quả. |
| D8 | #2 gRPC | **Làm, Python trước rồi C++**: wheelhouse `grpcio-tools` + requirements của `grpc-interface-support` cài sẵn trong toolchain; Conan `grpc` vào cache image C++ (build trên CI); block `sv_grpc_call`, simulator `services:`, service mẫu (profile `grpc`) cho parity. Rust/WASM: không hỗ trợ (S7 báo `OPCODE_UNSUPPORTED_BY_BACKEND`). | Mở đường cho #3 qua gRPC; điều kiện ADR-0043 §5 đạt được bằng việc đóng gói toolchain. Làm sau cùng vì nặng nhất. |
| D9 | #3 Standalone | Theo ADR-0044 §1: nhiều project + MQTT. Run song song đã có (ADR-0057) ⇒ thêm hướng dẫn + gate hai app nói chuyện qua MQTT trên stack. Không thêm "project group". | Đủ cho nhu cầu; không thêm khái niệm mới. |
| D10 | #4 Per-run/multi-user | **Đã đáp ứng** bởi ADR-0057 (sandbox databroker mỗi run, quota, hết hạn) + ADR-0032 (quyền theo workspace). Không làm pool stack tĩnh. | Pool tĩnh chỉ cần khi không có sandbox; ADR-0057 làm tốt hơn mà không cần docker.sock. |
| D11 | #5 databroker ≥ 0.7 | **Nâng lên 0.7.1** (`ghcr.io/eclipse-kuksa/kuksa-databroker:0.7.1@sha256:529d8c6d3cc223362667672978bcb8f92c4d356b25aedd336e7a2e004d7279bd`, kiểm 2026-10-25); bỏ `--enable-databroker-v1` và lựa chọn quay lại `sdv.databroker.v1` (`SV_DATABROKER_API=*=sdv.databroker.v1`); gate: parity P3 7/7 ×3 backend + WASM, gate M17 runtime, `@live`. | Điều kiện ADR-0047 §4 đã đạt (2026-10-17: C++/Python/Rust mặc định `kuksa.val.v2`, parity 7/7 mỗi backend). 0.6.1 vá lỗ hổng `OpenProviderStream`: client chỉ có quyền đọc đăng ký được làm provider và trả giá trị giả cho người khác. 0.7.0 xoá `sdv.v1` (không còn ai dùng mặc định), sửa `min_sample_interval`, kiểm đầu vào v2 chặt hơn. 0.7.1: chịu provider trả rỗng/chậm, opentelemetry 0.32 (bảo mật). |
| D12 | #6 Quick Run | Giữ **không làm** (ADR-0048). | SynCode Python ~0,7 s; thêm runtime thứ năm phải giữ parity. |
| D13 | #7 Sub-workflow + `sv_rate` | **Làm**: `sv_rate` (giới hạn tần suất) như block mới đủ simulator + 3 backend; sub-workflow = gọi workflow khác **inline lúc compile** (không runtime mới), cấm đệ quy. | Hai nhu cầu thật của workflow lớn; inline giữ parity tự động. |
| D14 | #8 Kanto | **Làm phía deploy**, không chạy Kanto trong stack: Deploy sinh manifest container-management của Kanto cho image đã push (M18). | Giá trị là đưa app lên xe; chạy Kanto trong stack đòi quyền container (luật cứng 10). |
| D15 | #9 IDE proxy + SSO | **Làm**: profile `remote-ide` với reverse proxy cấu hình tĩnh (Caddy) + forward-auth gọi BFF studio kiểm phiên và quyền project; code-server vẫn không bind ra ngoài. | Cần khi mở IDE ra mạng; không đụng docker.sock. |
| D16 | M15 T01/T09/T10 | PO đã chấp thuận ma trận và video ⇒ ✔ sau lần quay lại cuối cùng (bước cuối của M21, khi UI không đổi nữa). | |

## 3. Thứ tự
1. M20-T09 đóng (live `@live`, video, báo cáo).
2. Ghi chấp thuận: ROADMAP tổng quan M12–M20, ADR (xong), D4, D10, D12.
3. M11: D2 + D3 theo lô; D5; theo dõi D1 mỗi đêm.
4. M18-T06: D7.
5. M14: D9 → D13 → D14 → D15 → D11 → D8.
6. M15 + release: chạy lại toàn bộ `@live`, quay video, D16, D6.

## 4. Theo dõi
Trạng thái từng dòng ở [docs/ROADMAP.md §M21](../../docs/ROADMAP.md#m21--hoàn-tất-roadmap).
