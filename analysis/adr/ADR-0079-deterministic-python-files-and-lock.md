# ADR-0079: native Python file set and immutable build lock

Status: Accepted for M25-T05 implementation under user delegation, 2026-10-31.
T04 local IR gate PASS; runtime and deployment acceptance remain OPEN.

Generate native async Python functions/if/loops and region helpers, not an IR
interpreter disguised as source. Context methods implement typed operations and
expressions; every node has a trace span that ends before its continuation starts.
Loop/Parallel await child outcomes and cleanup. Result handlers preserve original
failure even if cleanup succeeds. Generated main launches only when explicitly
executed; importing/deploying files never starts a workflow.

The pure emitter returns fixed relative paths: app/__init__.py, app/flow.py,
app/main.py, rfir.json, rss-catalog.json, profile.json, units.v1.json, registry.json,
workflow.json, rflow.lock.json. No writes, formatter, timestamp, random ID, LLM or
user-controlled output path. Python values are safely emitted as data literals;
node IDs are trace strings, never source identifiers. Region function names are
deterministic traversal counters.

workflow.json is normalized source without UI, with sorted nodes/edges and filled
defaults. Project canvas layout is stored separately, so moving nodes changes no
executable/source/IR/artifact hash. Lock binds workflow/IR/catalog/profile/units/
registry/compiler/runtime identities, generated Python source hash and every
non-lock file's exact UTF-8 SHA256. artifactHash hashes the canonical lock without
its own artifactHash; the lock cannot recursively hash itself. No circular fields
are embedded into flow.py.

Runtime version is pinned now; runtimePackageHash may be supplied only from a
verified actual wheel after T06. T05 goldens omit that unavailable field rather
than fabricate a runtime digest. Live deploy must reject missing/mismatched
runtime-package provenance once deployment exists. Runtime verifies lock and
source identities before activation. Mapping/source/map context bindings remain
separate required live target metadata; graph IDs cannot grant motion permission.

Verification: RW-A..D graph/IR/file-set goldens twice byte-identical; Python syntax
and native-control AST, hash/lock consistency, UI exclusion and hostile text as
literal data. Actual generated app execution/conformance belong to T06/T07/T08;
syntax/goldens are not robot or runtime acceptance. Final full video remains M27.

Validation: 38 groups PASS /14.726 s. Complex templates exposed exponential oneOf recursion; opcode-discriminated closed schemas and exclusive count/forever validation preserve accepted wire shapes while visiting nested bodies once. Negative closed/nested variants and four-template time bound cover the change. Runtime execution remains unaccepted.
