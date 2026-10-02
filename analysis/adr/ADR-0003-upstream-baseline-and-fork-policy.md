# ADR-0003: Baseline Sim `v0.7.13` và chính sách fork/đồng bộ upstream

- **Status:** Accepted (2026-10-01 — baseline SHA đã dùng thật để tạo `modules/simvehicleapp-studio`, verify bằng `git log -1`) · **Date:** 2026-09-30 · **Level:** L0
- **Related:** Master Plan §0.1, ADR-002 (cũ); [00 §2](../00-research-findings.md#2-simstudioai-simstudioaisim--v0713--cấu-trúc-thật); R9

## Context
- Master Plan pin `v0.7.13` (`ad0b8678…`, 2026-06-24). Tại 2026-09-30 upstream đã `v0.9.6` với refactor lớn (apps/desktop, packages/emcn, mothership, custom-blocks enterprise).
- SimVehicleApp chỉ cần: canvas ReactFlow, workflow store/persistence, auth, realtime, providers. Tất cả đã có ở v0.7.13.

## Decision
1. Fork `simstudioai/sim` tại **tag `v0.7.13`, commit `ad0b8678b5dc4b6d5703481d567f29c9facc6f67`** thành repo `simvehicleapp-studio`, branch `main` bắt đầu từ `vehicle-studio/baseline`.
2. **Không** tự động merge/rebase upstream. Upstream là nguồn tham khảo: chỉ **cherry-pick có chọn lọc** bản vá bảo mật/bug ở vùng code còn giữ (canvas, store, auth, db, realtime), mỗi lần kèm ghi chú trong `docs/UPSTREAM_SYNC.md`.
3. Mỗi quý đánh giá upstream (security advisories, dependency CVE) — không nâng baseline trừ khi có ADR mới.
4. Không cherry-pick bất kỳ thứ gì từ `apps/sim/ee/**` hay tính năng Enterprise.
5. `docs/BASELINE.md` ghi SHA Sim, SHA template C++/Python, SDK, image digests, ngày.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Baseline v0.9.6 (mới nhất) | Bề mặt lớn hơn nhiều (desktop, mothership…) phải gỡ; custom-blocks là EE nên không có lợi ích; master plan đã phân tích v0.7.13 |
| Theo dõi `main` liên tục | Breaking refactor thường xuyên (registry.ts…), tốn công, rủi ro license EE lẫn vào |

## Consequences
+ Nền ổn định, phạm vi refactor biết trước. − Không nhận tính năng mới của Sim; vá bảo mật phải tự làm/cherry-pick.

## Implementation
| Task | Milestone |
|---|---|
| Tạo repo fork, tag `baseline-v0.7.13`, `docs/BASELINE.md`, `UPSTREAM_SYNC.md` | M0 |
| Renovate/Dependabot cho dependency bảo mật (không cho upstream Sim) | M1 |

## Verification
`git merge-base` của `simvehicleapp-studio/main` với upstream = `ad0b8678…`; CI kiểm tra không file nào khớp đường dẫn `apps/sim/ee/`.
