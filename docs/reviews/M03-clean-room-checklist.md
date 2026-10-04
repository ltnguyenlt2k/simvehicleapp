# M03-T14 — Checklist clean-room (Scratch) cho M3

> Phạm vi: mọi thay đổi M3 về ngữ nghĩa thực thi và block logic/flow (ADR-0004 §2, ADR-0012 §9, [05 §3.7](../../analysis/05-blocks-and-execution-model.md#37-clean-room-đối-với-scratch)).
> Dev phase không dùng PR (ADR-0009) nên checklist ký trong tài liệu này; commit liên quan: `git log --grep "M03-T"`.
> Người lập: Claude Code (agent), 2026-10-04. Người ký: PO.

## 1. Nguồn đã dùng
| Nguồn | Dùng cho | Ghi chú |
|---|---|---|
| `analysis/05` §2–§3, ADR-0012, ADR-0013, ADR-0018 | ngữ nghĩa trigger/run/yield/concurrency, danh mục block, SVX | tài liệu dự án, viết bằng mô tả khái niệm |
| Source Sim v0.7.13 (Apache-2.0) trong `modules/simvehicleapp-studio` | canvas, handle id, subflow `loop`/`parallel`, panel Variables, `TagDropdown`, `react-simple-code-editor` | upstream được phép (ADR-0003/0008); thay đổi đánh dấu `// SV:` và khai báo ở `UPSTREAM_SYNC.allow` |
| COVESA VSS 4.0/4.2 (MPL-2.0) | path, kiểu, `allowed` trong spec/test/conformance | fixture không sửa, có PROVENANCE |
| Scratch Wiki — danh sách tên opcode | **chỉ** để lập denylist CI (từ 2026-10-01) | không đọc source `scratch-vm`/`scratch-gui` |

## 2. Checklist
| # | Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Không mở/đọc/copy source `scratch-vm`, `scratch-gui`, `scratch-blocks` khi viết parser, BlockSpec, semantics, conformance | ✔ (agent tự khai) | nguồn ở §1; không có dependency `scratch-*` (`scripts/license/scan.sh` PASS) |
| 2 | Tên opcode/block tự đặt theo quy ước `namespace.verb` / `sv_*`, không khớp denylist | ✔ | `python3 scripts/ci/scratch_denylist.py` → PASS (0 violation), quét core (36 BlockSpec), contracts (conformance, golden), studio (`blocks/vehicle`, `components/sv`, `lib/sv`) |
| 3 | Không dùng asset/icon Scratch | ✔ | icon block = `lucide-react` (ISC) trong `blocks/vehicle/icons.ts` |
| 4 | Ngữ nghĩa thực thi suy từ mô tả khái niệm (05 §3, ADR-0012), không từ hành vi chi tiết của Scratch | ✔ | các điểm chưa rõ được chốt bằng conformance C01–C38 và ghi ở Notes ADR-0012 2026-10-04 (mốc ban đầu, tick timer, tràn queue/maxRuns, join any/none…), không đối chiếu với Scratch |
| 5 | Parser SVX viết tay (Pratt), không dùng thư viện biểu thức ngoài, không `eval` | ✔ | `core/packages/expr` (không dependency runtime), fuzz 10 phút PASS |
| 6 | Không có cơ chế "sprite/clone/broadcast/stage" hay tên khái niệm đặc trưng Scratch trong UI/spec | ✔ | `grep -rniE "sprite|clone|broadcast|green flag"` trên `core/packages/{blocks,expr}`, `blocks/vehicle`, `components/sv`, `fixtures/conformance`: không có kết quả (trừ `structuredClone` của JS) |
| 7 | CI giữ bảo vệ cho thay đổi sau này | ✔ | job `studio-guards` chạy `scratch_denylist.py` mỗi push |

## 3. Ký
- [ ] PO xác nhận checklist (điền ngày, tên): ______________________
