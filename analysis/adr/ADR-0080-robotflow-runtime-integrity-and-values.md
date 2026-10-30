# ADR-0080: RobotFlow runtime integrity and typed value boundary

Status: Accepted for M25-T06 implementation under the user's delegation,
2026-10-31. Runtime execution and live acceptance remain OPEN.

## Context

Generated source must run only after all artifact identities and the installed
runtime package pin agree. Unknown observations must not turn into numeric zero
or a false condition that accidentally selects a motion branch. Runtime must not
import compiler or ROS implementations.

## Decision

`robotics/rfrt` is an independent Python 3.12 package. It consumes only versioned
wire/data artifacts. Before application import, read a closed ten-file set through
non-following file descriptors, reject extra Python/package paths, duplicate JSON
keys, nonfinite numbers, oversize files and symlinks, then verify file/source/
artifact and semantic identities against the trusted installed wheel identity.
Execute the returned immutable checked bytes; do not reopen application code.
Artifact hashes prove integrity/identity, not trust in arbitrary Python; the
runner accepts compiler-produced artifacts and provides process isolation.

The runtime independently evaluates the closed expression AST, without eval,
source parsing or compiler imports. Literals are already normalized to base
units. RSS samples and variables use their declared storage units; conversions
use the shared unit data with decimal precision 50. Variables retain declared
storage units, including percent and affine temperature. Arithmetic checks exact
types, finite floats and declared integer bounds before use or mutation.

Unavailable observations have an explicit non-coercible sentinel. A condition
cannot choose a branch from unknown. Boolean short circuit uses known dominating
values (false AND, true OR); unavailable arithmetic remains unavailable. All
operands of one evaluation use one explicitly refreshed snapshot. Freshness,
source epoch/clock and lease checks belong to the BusClient boundary, not these
pure operations; they still require implementation and actual transport tests.

## Verification and scope

Artifact tests consume data-only RW-A..D compiler outputs. The runtime digest in
these unit fixtures is explicitly synthetic and is never claimed as a real wheel
pin or deployed runtime. Missing pins from T05 artifacts must be rejected. Test
each file's mutation/removal, rehashed yet inconsistent manifests, symlink
components, module-shadowing files, retained checked bytes and strict JSON.

118 compiler AST wire fixtures carry hand-computed expected values from the
compiler test table; no compiler implementation is imported by runtime tests.
Dynamic source/variable cases add missing data, percent/temperature round trips,
integer/float boundaries, zero division and inverted clamp tests. Full T06 needs
BusClient/behavior/Hold/trace/event/shutdown plus an actual reproducible wheel;
T07 real broker/mock conformance and T08 actual dog simulation remain mandatory.

## Native execution/scheduling checkpoint

Context executes operations called by native generated source, never statement
IR. Failed operations remain failed after successful cleanup. Node spans finish
before outcome continuation, and logs inherit current node identity. Parallel-any
awaits losing cleanup, including repeated parent cancellation. Behavior workers
own one coroutine each; restart replaces a child only after recovery, and bounded
event identities are never evicted into accidental replay. Fresh true debounce
resets on unavailable observations, but requires fresh false to rearm after firing.
Periodic triggers skip missed ticks; on-change ignores unchanged capture refresh.
Loss/deadline dispatches independent Stop before waiting for child cleanup. The
BusClient/runner must still enforce bounded RPC/process shutdown and physical
release; async cancellation alone is not physical cancellation. Thirty internal
fake-bus groups PASS /4.052 s; actual transport/live gates remain open.
