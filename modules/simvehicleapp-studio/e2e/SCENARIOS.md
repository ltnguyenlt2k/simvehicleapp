# Ma trận kịch bản E2E (M15-T01)

> Mỗi hàng = một luồng + tiêu chí PASS, truy ngược tới yêu cầu ([01-requirements](../../../analysis/01-requirements.md))
> và ADR. Cột **Test** là spec Playwright hiện có (`tests/`) hoặc task M15 sẽ thêm. Thẻ `@live` = cần stack đầy đủ
> (databroker, toolchain) — chạy nightly/local; còn lại chạy mỗi PR (CI job "studio image builds from source + E2E").
> Quy ước dữ liệu: user/email theo `Date.now()` của lượt chạy, stack tách biệt (`docker compose -p sv-e2e…`).
> Trạng thái: ✔ có test PASS trên CI · ◐ có một phần · ☐ chưa có.

## A. Nền tảng, đăng nhập, cộng tác
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| A1 | Sign-up ⇒ workspace mang thương hiệu SimVehicleApp | landing đúng workspace, không chữ "Sim Studio" | FR-PLT-01/06 · 0003 | `m1-gate` | ✔ |
| A2 | Tạo workflow, reload vẫn còn | URL `/w/<id>` mới, sau reload thấy lại | FR-WF-01 | `m1-gate` | ✔ |
| A3 | Sign-up bị giới hạn tần suất (429) | form báo lỗi, chờ `X-Retry-After` rồi thành công | ADR-0032 | `lib/studio.submitAuth` (dùng trong mọi spec) | ✔ |
| A4 | Hai phiên realtime: block thêm ở phiên 1 hiện ở phiên 2 | thấy trong ≤ 15 s | FR-WF-01 | `m1-gate` | ✔ |
| A5 | Ba phiên cùng kéo thả, xung đột chỉnh cùng prop | state hội tụ, không mất block | — | M15-T07 | ☐ |
| A6 | Mất kết nối realtime / catalog / compiler | UI báo đúng service, không mất dữ liệu, tự hồi phục | NFR · 0033 | M15-T07 | ☐ |
| A7 | Restart studio ⇒ workflow gate còn nguyên | graph sau restart = trước | FR-PLT-02 | `m2-gate @after-restart` | ✔ |

## B. Kéo thả — toolbar (mọi block)
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| B1 | Toolbar có mọi block `sv_*` (38; 3 spec container đi qua Loop/Parallel của Sim) | mỗi block thấy được và thả ra canvas được | FR-BLK-01…08 · 0011 | `m3-blocks` (một phần), `m14-composite` (5 block M14) | ◐ |
| B2 | Mỗi block thả vào canvas rỗng (overlay) và canvas có sẵn | node mới tên `<Tên> 1`, editor mở đúng subBlock theo spec | 0011 | M15-T02 | ☐ |
| B3 | Kéo block vào / ra container Loop, Parallel | `parentId` đúng; container-mapping ⇒ `sv_repeat`/`sv_while`/`sv_parallel` | FR-BLK-05 · 0011 Notes M03-T10 | M15-T02 | ☐ |
| B4 | Thả bị từ chối: workflow khoá, quyền viewer | không tạo node, thông báo rõ | 0032 | M15-T02 | ☐ |
| B5 | Flow block hiện handle nhánh có tên | `then/else`, `case-<i>/default`, `ok/timeout`, `stable/broken`, `changed/unchanged` | 0011 | `m3-blocks` | ◐ |

## C. Kéo thả — panel Vehicle
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| C1 | Kéo Speed (sensor) ⇒ menu chỉ Read/When changes, không Set | menu đúng kind | FR-BLK-01/02 · 0010 §6 | `m2-gate` | ✔ |
| C2 | Actuator ⇒ có Set; attribute ⇒ Read attribute; array ⇒ không Set | bảng kind × menu | 0010, 0018 | M15-T03 | ☐ |
| C3 | Lặp C1–C2 cho release v4.0 và v4.2 | cây đổi không rebuild | FR-VSS-02 | `m2-gate` (đổi release) + M15-T03 | ◐ |
| C4 | Click/bàn phím thay cho kéo | cùng menu, block thêm giữa viewport | 0011 Notes M02-T10 | M15-T03 | ☐ |

## D. Nối & chỉnh sửa
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| D1 | Nối trigger → bước → actuator, lưu | graph lưu đúng cạnh | FR-WF-01 | `m2-gate`, `m5-simulate` | ✔ |
| D2 | Nối mọi loại handle (nhánh, case, container start/end) | adapter ra đúng `fromHandle` | 0011 | `m3-goldens` (7 golden) + M15-T04 | ◐ |
| D3 | Nối sai bị chặn (vòng, fan-out, handle lạ) | không tạo cạnh hoặc Problems báo đúng mã | 0016 | M15-T04 | ☐ |
| D4 | Xoá / undo / redo / copy-paste | trạng thái khôi phục đúng | — | M15-T04 | ☐ |
| D5 | Đổi tên block ⇒ tham chiếu `<…>` cập nhật | biểu thức đổi theo tên mới | 0013 | M15-T04 | ☐ |
| D6 | Editor biểu thức / thời lượng / giá trị theo kiểu | gợi ý `<`, chọn signal, đơn vị ms/s/min | 0011 §5 | `m3-blocks`, `m5-simulate` | ◐ |

## E. Kiểm tra, mô phỏng
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| E1 | 7 golden (GW-A…G) dựng hoàn toàn bằng UI | Problems sạch, adapter = `graph.json` golden | FR-WF-01/02 · 0042 | `m3-goldens` | ✔ |
| E2 | Verify báo narrowing ⇒ quick-fix Insert Convert ⇒ sạch | đúng mã, quick-fix sửa được | FR-WF-02/04 · 0016 | `m4-verify` | ✔ |
| E3 | Scenario ⇒ Simulate ⇒ timeline + replay overlay | write ở đúng t, badge replay | FR-RUN-01 · 0017 | `m5-simulate` | ✔ |
| E4 | Block composite (Battery status) simulate | đọc đủ member, 1 write | FR-BLK-07 · 0045 | `m14-composite` | ◐ (chờ CI) |
| E5 | Filter + State machine trên canvas, simulate | giá trị lọc/chuyển trạng thái đúng như conformance C40/C41 | FR-BLK-08 · 0049 | M15-T02 | ☐ |

## F. SynCode, Run, IDE, Export (stack thật)
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| F1 | Projects: tạo project, gán workflow | project hiện, workflow gán | FR-WF-05 · 0026 | `m7-syncode` | ✔ |
| F2 | SynCode pass/fail: stage, build log, diagnostic focus block | stage đúng, click diagnostic ⇒ block | FR-RUN-02 · FR-WF-04 | `m7-syncode`, `m7-syncode-live @live` | ✔ |
| F3 | Run ⇒ log + trace (console + badge trên block), Signals inject + record, Stop | trace đúng block, inject tác động | FR-RUN-03…06 · 0027 | `m8-run`, `m8-run-live @live` | ✔ |
| F4 | Open IDE ⇒ file sinh hiện trong code-server; Export zip | zip có workflow + notices | FR-IDE-01 · FR-EXP-01 · 0028, 0031 | `m9-ide-export-live @live` | ✔ |
| F5 | Python project: SynCode ⇒ Run trên KUKSA ⇒ inject ⇒ hazard | như F3 với `language=python` | FR-CG-03 · 0040 | `m12-python-live @live` | ✔ |
| F6 | Rust project (experimental) end-to-end qua UI | như F5 với `language=rust` | FR-CG-04 · 0041 | M15-T06 (mở rộng) | ☐ |

## G. Trợ lý AI (provider giả lập)
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| G1 | Prompt ⇒ đề xuất patch trên canvas ⇒ Accept (lưu) | patch áp dụng, lưu | FR-AI-01/04 · 0030 | `m10-assistant` | ✔ |
| G2 | Hành động có side-effect cần xác nhận (sửa input) | dialog xác nhận, input đã sửa được dùng | FR-AI-05 | `m10-assistant` | ✔ |
| G3 | Eval với LLM thật | bộ eval đạt ngưỡng | FR-AI-02 | **bỏ qua** (chưa có API key — PO) | — |

## H. Full luồng & video
| ID | Luồng | Tiêu chí PASS | FR / ADR | Test | TT |
|---|---|---|---|---|---|
| H1 | Tutorial "Overspeed warning": canvas ⇒ Simulate ⇒ SynCode ⇒ Run ⇒ inject ⇒ trợ lý | toàn luồng PASS | toàn bộ | `tutorial-live @live` | ✔ |
| H2 | Full luồng M15-T06: signup → GW-A bằng kéo thả → lint → Simulate → SynCode → Run → Signals → IDE → Export → AI → restart | mọi chặng PASS, dữ liệu còn sau restart | toàn bộ | M15-T06 | ☐ |
| H3 | Video tất định `scripts/sv demo-video` (1920×1080, chú thích) | chạy lại ra cùng nội dung | — | M15-T09 | ☐ |
| H4 | 3 lượt CI xanh liên tiếp, 0 flaky | — | — | M15-T08 | ☐ |
