# ADR-0048: Không làm "Quick Run interpreter app" — simulator + SynCode đã phủ nhu cầu

- **Status:** Proposed
- **Date:** 2026-10-07
- **Level:** L2 Component
- **Deciders:** Claude Code theo uỷ quyền PO 2026-10-06 — chờ PO xác nhận
- **Related:** [ADR-0017](ADR-0017-simulator.md), [ADR-0042](ADR-0042-semantic-parity-testing.md); [phases/M14](../phases/M14-services-curated-multiuser.md) #6 ("chỉ nếu nhu cầu thực tế")

## Context
- Ý tưởng: một app Velocitas "thông dịch" IR lúc chạy để Run ngay không cần sinh code/build.
- Thực tế đo (M12/M13): SynCode Python ~0,7 s, C++ ~4,9 s (project ấm); simulator chạy trong studio tức thì, có timeline/replay;
  parity P3 chứng minh code sinh = simulator.
- Interpreter là runtime thứ năm phải giữ parity (P1/P3) và đi ngược nguyên tắc "code sinh đọc được, export được".

## Decision
**Không làm** Quick Run interpreter. Vòng lặp nhanh = Simulate (studio) + SynCode Python khi cần chạy trên databroker thật.
Xem lại chỉ khi có số đo người dùng cho thấy thời gian SynCode là rào cản (ngưỡng đề xuất: trung vị > 10 s).

## Alternatives considered
| Phương án | Ưu | Nhược | Vì sao loại |
|---|---|---|---|
| Interpreter IR (Python) | Không build | Runtime thứ 5, parity thêm, không export | Không có nhu cầu đo được |

## Consequences
Không thêm module; không nợ parity.

## Verification
Theo dõi thời gian SynCode (metrics observability ADR-0033); ngưỡng trên mới mở lại.

## Notes / Deviations
