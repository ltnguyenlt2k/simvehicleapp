# ADR-0077: bounded typed expressions and one declarative unit contract

Status: Accepted for M25-T03 implementation under user delegation, 2026-10-31.
M25 schema/registry local tests PASS; no parser/runtime acceptance implied.

Publish robot-units.v1 as a data-only contract: existing RSS unit definitions and
explicit dimension vectors (length, mass, time, current, temperature, angle).
RSS and RobotFlow consume this artifact, not each other's implementation. Keep
the existing RSS units.yaml as a checked compatibility snapshot; tests/precheck
must prevent drift. Catalog bytes/hash must remain unchanged. Compiler/runtime
algorithms stay separate and must conform to the same versioned unit semantics.

Expressions use a handwritten bounded lexer/Pratt parser, never eval. Literals,
RSS paths, declared vars, arithmetic/comparison/boolean operators and only
abs/min/max/clamp are permitted. Quoted string literals use JSON double quotes.
No indexing, arbitrary calls, Python attributes, lambdas or executable objects.
Limit 4096 characters, 512 tokens/AST nodes, nesting 64. Numbers must be finite;
integers fit signed int64. Constant zero division/overflow is a compile error;
dynamic arithmetic failure is a runtime safe-failure path, never NaN control.

Numeric evaluation is normalized to base units; RSS/var read conversion uses the
declared source unit, literals normalize at compile time. Percent is scalar
scale 0.01; cm/ms likewise normalize. Angle remains an independent dimension.
Addition/comparison require compatible dimensions; multiplication/division compose
vectors. Boolean and string types never silently coerce to numeric. Min/max/clamp
require compatible numeric arguments; clamp also needs valid ordered bounds.
Unit scale/offset JSON constants are decimal: normalize conversion with decimal
precision 50 then round once to float64 (identity conversion retains integers).
This avoids binary offset cancellation for signed Celsius literals; ordinary
expression arithmetic remains checked IEEE float/integer, with exact equality
semantics, never an implicit epsilon comparison. RSS conversion helpers conform
to the same decimal definition; catalog bytes/hash are unchanged.
Affinely offset temperatures can be converted/compared, but temperature arithmetic
and abs are rejected in v0.1 until absolute/delta semantics are explicitly added.

IR AST is closed and typed; source unit metadata cannot be inferred from host
clock time. Compiler static checks and runtime checked numeric operations must
agree. Canonical IR does not include parser implementation objects or timestamps.
At least 100 valid/invalid expression cases, precedence, units, numeric edges,
malicious syntax and limits must pass before advancing to compiler integration.
