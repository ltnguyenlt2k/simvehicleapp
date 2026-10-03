---
name: golden-and-parity-tests
description: Change golden workflows, generated snapshots, runtime conformance or simulator versus binary parity tests.
---

# Golden, conformance & parity

Tham chiếu: `analysis/14-testing-strategy.md`, ADR-0042, `analysis/05-blocks-and-execution-model.md` §5.

## Fixture layout (simvehicleapp-contracts/fixtures/golden/GW-X-*/)
`sim-state.json` → `graph.json` → `ir.json`; `scenario.yaml`; `expected.trace.json`; `expected.writes.json`. Snapshot code sinh nằm trong repo backend (`test/golden/GW-X/`).

## Cập nhật snapshot
- Dùng script update snapshot thực của module (chỉ dùng `--update-golden` nếu script hỗ trợ) và **luôn review diff**; PR phải giải thích vì sao output đổi (đổi semantics ⇒ ADR).
- Không sửa tay file expected để "cho test xanh".

## Conformance scenario (executable spec của ADR-0012)
`fixtures/conformance/<id>.yaml`: `ir` (hoặc tham chiếu golden), `inputs [{t, path|topic, value}]`, `until`, `expect.trace`, `expect.writes`. Chạy trên: simulator (core), runtime C++ (gtest runner), runtime Python (pytest runner).

## Parity (nightly)
Binary thật + databroker thật + scenario player; chuẩn hoá trace (bỏ ts tuyệt đối, lưới 10 ms, dung sai timer ±20 ms, float eps 1e-5) rồi so với expected.

## Khi test đỏ
Báo đúng output lỗi; tìm nguyên nhân ở module gây lệch (simulator vs runtime), không nới dung sai trừ khi có ADR.

Task thông thường chạy scenario bị ảnh hưởng; toàn conformance/parity ở gate/CI theo phase. Không build lại mọi binary/golden cho sửa prose. Check PASS không chạy lặp khi input chưa đổi.
