# RobotFlow compiler boundary

Current increment: versioned graph/block/IR schemas, 24 data-only blocks and their
validated canonical registry, bounded typed expression parser and S0–S6 IR compiler.
Python source emitter and runtime are not implemented yet.
M25 tasks and acceptance remain authoritative; no live workflow claim.

Inputs are robotflow.v1 JSON, rss-catalog.v1, a closed approved robotflow-profile.v1
policy, canonical unit data and block.v1 registry. `compile_workflow` returns
diagnostics and canonical typed IR (build) or diagnostics alone (lint); a source
file-set emitter is next. The compiler
does not write project files, call an LLM, import ROS or import vehicle modules.
Graph UI coordinates are saved for the canvas and excluded from compiled hashes.

Wire schemas live in /contracts (robotics/contracts). Their checked-in JSON must
match deterministic robotflow_contracts.py output. Diagnostics preserve existing
RSS/PB code strings and add localized RF stages. Stage S0 additionally enforces
duplicate-key, finiteness, nesting and total-size limits; schema validation alone
does not provide those checks. Typed IR calls/opcodes are closed and every
statement includes source node identity. See ADR-0067/0069/0076.

Build the contract image, then `docker compose -f robotics/compose.yaml --profile
compiler-tools build robotflow` and `docker compose -f robotics/compose.yaml
--profile compiler-tools run --rm --no-deps robotflow`. Tests run network-none,
read-only and without robot authority. Requirements use already-pinned robotics
toolchain versions; no new package version or upstream implementation imported.
