# Review tài liệu và đường tới v1.0 — 2026-10-03

## Phạm vi và kết luận

Đối chiếu yêu cầu, bản đồ tài liệu, kiến trúc module, roadmap, phase M0/M1/M11, ADR nền tảng, hướng dẫn Compose/CI với checkout `a5f22f4` có thay đổi chưa commit. Giữ các thay đổi người dùng đã có trước review. Đây là review tính nhất quán và khả năng thực thi lộ trình, không phải chứng nhận toàn bộ API/schema chi tiết hay completion report của milestone.

Mục tiêu vẫn là: canvas VSS → Verify/IR tất định → Simulate → sinh C++ Velocitas → workspace ghi atomic → build/test → Live Run trên KUKSA/MQTT → log/trace/signals về UI; IDE, export và AI đề xuất WorkflowPatch hoàn thiện trong v1.0. Python/Rust và mở rộng M14 ở sau v1.0.

**M0 chưa qua gate.** Hạ tầng/spike có bằng chứng lịch sử; contracts/fixtures, CI root và review ADR bắt buộc còn thiếu. Không mở M1 từ kết quả spike.

## Phát hiện và xử lý

| Mức | Phát hiện / bằng chứng local | Cập nhật |
|---|---|---|
| Cao | ROADMAP và phase M0 cho phép dời contracts/CI sang M1, trái AGENTS §2.7 và DoD | Giữ T05/T06/T08 trong M0, làm rõ gate bao gồm DoD và prerequisite ADR |
| Cao | [Contracts](../../modules/simvehicleapp-contracts/README.md) chỉ là placeholder; không có `.github/` root; ADR-0004/0006/0007 còn Proposed | Ghi rõ blocker, không tick hoàn thành hay tự Accepted |
| Cao | README nói M0 complete, nhưng thiếu completion report và phần việc trên | Sửa trạng thái ở cả bản Việt/Anh; tách spike PASS khỏi milestone PASS |
| Cao | [ADR-0009](../../analysis/adr/ADR-0009-dev-phase-module-folders.md) đã đổi dev sang một repo, nhưng nguyên tắc module/scripts vẫn hướng dẫn submodule ngay | Đồng bộ kiến trúc, spec meta, bootstrap và CI; chỉ rõ script hiện có và script cần viết |
| Cao | ADR-0009 yêu cầu `release-split.sh` ở M11, task release chưa nêu đầu việc/kiểm chứng | Bổ sung M11-T10: split giữ lịch sử, lock/scripts, clone sạch, bootstrap/smoke |
| Cao | [Spike §8](../spikes/M0-spikes-report.md#8-sim-from-source) chưa build được studio từ source trên host thử nghiệm; S-5 là prebuilt | Thêm điều kiện source build/test cho M1; nguyên nhân lần build treo vẫn chưa xác minh, không kết luận do RAM |
| Vừa | Tổng feature ghi 157 và hoàn thành 7; bảng thực có 147 dòng M0–M11, 6 ✔, 1 ↷ | Sửa số đếm; dòng M0-T03 dời sang M11 không được coi là hoàn thành |
| Vừa | Bản đồ ghi 32 ADR, thực có 34 file ADR | Đồng bộ số lượng và chỉ dẫn đọc Status từng ADR |
| Vừa | ADR-0001 yêu cầu copy ADR Accepted sang `docs/adr/`, checkout chưa có | Ghi Notes / Deviations để xử lý khi đóng M0; không tự thay Decision |

## Thứ tự tiếp theo

1. Review ADR-0004/0006/0007 theo bằng chứng và quyết định của người có trách nhiệm; bổ sung Accepted copies theo ADR-0001. Không tự đánh Accepted chỉ vì tài liệu đã đồng bộ.
2. M00-T05 rồi T06: contracts alpha, generated types/service-kit, fixtures VSS và GW-A; validate cả input hợp lệ và input sai theo task. Schema/API thay đổi phải theo quy trình ADR/version.
3. M00-T08: CI root cho license theo phạm vi phase, ranh giới dependency, Compose; chứng minh trường hợp vi phạm bị bắt. Không làm gate license toàn sản phẩm trùng với phần gỡ EE của M1.
4. Đóng toàn bộ DoD/gate M0, ghi `docs/reports/M00.md` với lệnh, revision và bằng chứng. Tái dùng spike đúng input/pin; chạy lại khi có thay đổi hoặc nghi ngờ cụ thể.
5. Sau gate M0 và ADR prerequisite, làm M1 theo thứ tự task, xác minh image từ source refactor. Tiếp tục dependency graph M2–M11; dùng [bảng bằng chứng chuỗi sản phẩm](../../analysis/13-implementation-roadmap.md#bằng-chứng-đóng-chuỗi-sản-phẩm) để tránh hoàn thành module rời mà chưa có E2E.

## Kiểm chứng và giới hạn

- Đọc source local của root Compose, `scripts/sv`, module placeholder, Status ADR và report spike; kiểm đếm 34 ADR và 147 dòng feature M0–M11.
- `git diff --check`: PASS. Kiểm 214 link file Markdown trong phạm vi tài liệu: không có file đích thiếu; không xác minh URL ngoài hay mọi anchor heading.
- Không chạy build/test sản phẩm hoặc spike: thay đổi chỉ là prose; kết quả container trong report cũ là bằng chứng lịch sử, chưa được chạy lại trong lượt này.
- Không cần đổi pin hay research upstream online để giải quyết các mâu thuẫn trên. Khi triển khai API phải kiểm bằng chứng đúng pin và research nguồn chính thức nếu còn thiếu theo `upstream-verify`.
- Review này làm rõ kế hoạch và tiêu chí kiểm chứng; sản phẩm v1.0 chỉ hoàn tất khi toàn bộ gate liên quan PASS và M11 được ký duyệt.
