## Semantics every backend implements

Source of truth: ADR-0014 (+ Notes 2026-10-06) and ADR-0015 (+ Notes 2026-10-06). The compiler has already checked types and units; a backend never re-infers them — every `$expr` operator carries its result `type` (and `unit` when it has one).

### Values

| Form | Meaning |
|---|---|
| `{"$const": v, "type": t, "unit"?}` | Literal. `int64`/`uint64` values are decimal strings (ADR-0018 §7); other integers and floats are JSON numbers. |
| `{"$ref": "nK.out"}` | Output `out` of trigger/node `nK`; `nK` always runs before the use (dominance checked by S6). Immutable within a run. |
| `{"$signal": "sK"}` | Latest cached value of signal `sK` (subscription), read when the expression is evaluated. |
| `{"$state": "vK"}` | Current value of workflow variable `vK` (shared by all runs of the app). |
| `{"$template": [...]}` | Concatenation; strings are copied, expressions are formatted (below). |
| `{"$expr": {"op": …, …, "type": t, "unit"?}}` | Operator application, operands below. |

### Operators

| `op` | Operands | Rule |
|---|---|---|
| `+` `-` `*` | `l`, `r` | Integers: exact `int64` arithmetic — the compiler proved the result range fits `int64`, so there is no overflow. Any float/double operand ⇒ IEEE `double`. |
| `/` | `l`, `r` | Always `double` (IEEE: `x/0` ⇒ ±Inf/NaN). There is no integer division. |
| `%` | `l`, `r` | Always `double`, `fmod` (sign of the dividend). Python must use `math.fmod`, not `%`. |
| `neg` | `a` | Unary minus. |
| `==` `!=` `<` `<=` `>` `>=` | `l`, `r` | Numbers compare mathematically (integer vs double as double, exact below 2^53, which the compiler guarantees); strings/booleans only `==`/`!=`. |
| `&&` `\|\|` | `l`, `r` | Booleans, short-circuit (operands are pure). |
| `!` | `a` | Boolean not. |
| `?:` | `cond`, `then`, `else` | Ternary. |
| `abs` `min` `max` `clamp` `round` `floor` `ceil` `scale` `in_range` `now_ms` | `args` | SVX whitelist (ADR-0013 §2). `round` = half away from zero; `scale(x, inMin, inMax, outMin, outMax)` = `outMin + (x − inMin)·(outMax − outMin)/(inMax − inMin)`; `now_ms` = monotonic ms. |
| `array.len` | `value` | `uint32` length. |
| `array.at` | `value`, `index`, `default`? | Element; out of range ⇒ `default` (trace `ARRAY_INDEX_OUT_OF_RANGE`, warn). |
| `array.index` | `value`, `index` | Element; out of range ⇒ the step takes its `error` branch (ADR-0018 §4). |
| `array.contains` | `value`, `item` | Membership. |
| `unit.convert` | `value`, `from`, `to`, `scale`, `offset` | `value * scale + offset` in IEEE `double`, exactly one multiply and one add — C++ is compiled with `-ffp-contract=off` (no FMA) so every backend gets the same bits. |
| `type.cast` | `value`, `to` | Real ⇒ integer: round half away from zero, NaN ⇒ 0, then clamp to the range of `to`; integer ⇒ narrower integer: clamp; number/boolean ⇒ string: formatted as below. |
| `json.string` | `value` | JSON string literal of `value` (quotes and escapes), used inside JSON payload templates. |

### Formatting in templates

Numbers use the **shortest decimal that round-trips the value's own type** (`float` 0.1 ⇒ `0.1`, not `0.10000000149011612`); integers in decimal; booleans `true`/`false`; arrays as JSON.

### Control flow

- `next` maps output handles to the next node (`null` = the run ends there): `source` ⇒ `next`, other handles keep their name with `-` ⇒ `_` (`then`, `else`, `ok`, `timeout`, `stable`, `broken`, `case_0…`, `default`, `error`).
- Containers: `control.repeat`/`control.while` run `body.entry` then continue at `next.next`; `control.parallel` starts `args.branches[*].entry` and continues according to `args.join` (`all`, `any` cancels the others, `none` continues at once).
- Triggers carry their concurrency policy explicitly (`queue` ⇒ `queueMax`, `parallel` ⇒ `maxRuns`); execution semantics are ADR-0012 and the conformance cases in `fixtures/conformance/`.
- Pure blocks are folded into the expressions that use them when their value cannot change within a run; otherwise they appear as `logic.eval` nodes (`args.value`, output `result`).

### State that outlives a run

- `logic.in_range` with `mode: hysteresis` and `state.filter` keep state **per node** for the app's lifetime; every run of the workflow shares it; it is empty again after a restart.
- `state.filter` (ADR-0049 §1): `args.value` is a `double`; `mode` `moving-average` (mean of the last `window` samples, summed oldest → newest, then divided by their count), `median` (middle of the sorted last `window` samples, mean of the two middle ones when even) or `exponential` (first sample `y = x`, then `y = y + alpha · (x − y)`). Outputs `value` (`double`) and `samples` (samples in the window; total samples for `exponential`). IEEE-754 double arithmetic exactly as written (no fused multiply-add). A `value` that cannot be computed takes `error` and adds no sample.
- One block may lower into several nodes sharing its `src.blockId` (composite blocks ADR-0045: chained `vehicle.read`; state machine ADR-0049 §2: `control.branch` + `state.set` per transition); all but the first carry `src.inserted: true` and a `reason`.
