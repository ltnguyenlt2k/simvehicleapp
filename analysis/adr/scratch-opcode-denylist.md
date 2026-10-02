# Scratch opcode denylist (CI guard cho ADR-0004 §Clean-room)

> Nguồn: **Scratch Wiki** (`en.scratch-wiki.info/wiki/List_of_Block_Opcodes`, trang tài liệu cộng đồng, không phải source code) + câu trả lời công khai trên `scratch.mit.edu/discuss`, tra cứu 2026-10-01. Đây là **danh sách tên chuỗi** (opcode identifier), dùng để CI grep chống trùng tên — **không phải** đọc/copy source `scratch-vm`/`scratch-gui` (vẫn cấm theo ADR-0004 §Clean-room).
> Mục đích: phòng trường hợp một dev/agent vô tình đặt tên opcode/block trùng hệt tên Scratch khi "tham khảo khái niệm" — SimVehicleApp dùng quy ước đặt tên khác hẳn (`namespace.verb`, dấu chấm, chữ thường, không tiền tố category_) nên trùng khớp gần như không thể xảy ra ngẫu nhiên; CI chỉ là lưới an toàn.

## Quy tắc CI
```bash
# chạy trong CI của simvehicleapp-studio và simvehicleapp-core
grep -rEn -f analysis/adr/scratch-opcode-denylist.grep <paths kiểm tra: BlockSpec, opcode trong IR builder, test fixtures>
# match (khác rỗng) ⇒ FAIL build, bắt review thủ công
```
File `scratch-opcode-denylist.grep` (patterns, 1 dòng/pattern, ERE):
```
^(motion|looks|sound|event|control|sensing|operator|data|procedures|argument|pen|music|translate|videoSensing|wedo2|ev3|boost|gdxfor|makeymakey|microbit)_[a-zA-Z]+$
```
(10 category-prefix Scratch dùng cho **mọi** opcode chuẩn + 1 vài extension chính thức — baseline block không bao giờ dùng tiền tố `_` nối category kiểu này, nên pattern trên an toàn, không false-positive với `event.app_start`, `control.wait`… của SimVehicleApp vì SimVehicleApp dùng dấu `.` không phải `_`.)

## Danh sách tham khảo (ví dụ cụ thể đã tra cứu, không đầy đủ — pattern ở trên đã bao quát toàn bộ họ tên)
| Nhóm Scratch | Ví dụ opcode (nguồn: Scratch Wiki) |
|---|---|
| event | `event_whenflagclicked`, `event_whenkeypressed`, `event_whenthisspriteclicked`, `event_whenstageclicked`, `event_whenbackdropswitchesto`, `event_whengreaterthan`, `event_whenbroadcastreceived`, `event_broadcast`, `event_broadcastandwait` |
| control | `control_wait`, `control_repeat`, `control_forever`, `control_if`, `control_if_else`, `control_wait_until`, `control_repeat_until`, `control_stop`, `control_start_as_clone`, `control_create_clone_of`, `control_delete_this_clone` |
| motion | `motion_movesteps`, `motion_turnright`, `motion_turnleft`, `motion_goto`, `motion_gotoxy`, `motion_glideto`, `motion_glidesecstoxy`, `motion_pointindirection`, `motion_pointtowards`, `motion_changexby`, `motion_setx`, `motion_changeyby`, `motion_sety`, `motion_ifonedgebounce`, `motion_setrotationstyle` |

**Không được** dùng các chuỗi trên (hay bất kỳ chuỗi khớp pattern ERE ở trên) làm `opcode`/`type` của block/IR node trong SimVehicleApp.
