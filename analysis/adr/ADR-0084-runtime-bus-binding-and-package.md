# ADR-0084: Independent runtime bus binding and package

Status: Accepted for M25-T06 implementation under user delegation, 2026-10-31.
Runtime transport component in progress; full runtime/live acceptance OPEN.

## Decision

Runtime owns its generated Protobus stubs, consuming only the versioned proto
artifact. It never imports broker/provider/compiler/ROS implementation. Runtime
and protobuf build tools use versions already pinned in the robot stack; no
dependency download/install is permitted during application launch.

Explicit deployment recording freezes robot/profile/catalog and canonical target
context. Launch receives this binding; it must not silently record the connected
target as its own expected target. Mock source epoch is a transient run session;
its immutable mapping/source/kind/permission binding survives an explicit new
launch. ROS Brain/scene/map/source context belongs to immutable deployment.
Every active run captures fresh broker/provider epochs and cannot resume/reopen
or reacquire after any identity, transport, audit or clock-domain fault.

Normal and safety use separate gRPC channels/TCP subchannel pools. Typed Get
refreshes current captures; on-change subscriptions are not freshness heartbeats.
Missing/stale samples remain explicit unknown. Typed values, exact requested
paths, duplicate records, source clock/epoch and broker/provider sessions are
checked independently. Host receipt and host-domain capture age use host
monotonic time only. Never subtract ROS source time from host monotonic time;
ROS capture-age/future/paused/reset-clock qualification remains the adapter gate.

The transport component opens no lease and sends no actuator commands. Remaining
BusClient code owns one explicit lease with bounded renewal, no replay/reacquire,
correlated command/Hold admission/release and independent Stop. Structured normal
cancellation must preserve a failed cleanup and must not resume loop iterations.

The actual runtime wheel will use fixed build timestamps and pinned build tools;
hash real wheel bytes twice and install that exact wheel in the image. Store the
trusted installed wheel identity outside the application/wheel, avoiding a
self-referential hash. Generated main must ask trusted runtime to verify all
application bytes before loading flow code. An absent runtime hash is not accepted
for execution. A wheel/version pin is identity evidence, not a Python sandbox;
the independent runner still owns process/network/resource isolation.

## Verification

Transport unit tests use explicit fake typed servers over real gRPC sockets,
covering fresh false versus unknown, old capture with new receipt, wrong source
epoch/type, changed mapping and changed provider session without auto-resume.
These do not replace real broker/mock conformance or actual ROS acceptance.
Package, higher BusClient, launch/shutdown and full conformance remain required.


### T06 installed runtime local gate — 2026-10-31

Actual deterministic wheel 0.1.0 / protocol1.6 is built twice byte-identically,
installed and tested through isolated Python (58 groups PASS /9.307s). Pin:
`sha256:30f70e47042472f70bb53d93a6a4319db4662a02d7668e9840d82ea3c78ceb20`.
The SDK binds recorded target identity, owns bounded lease/command/Hold lifetimes,
confirms release before handover, keeps cancellation streams alive, and uses an
independent Stop lane. No import/startup implicit Arm or authority reacquisition.
CLI verifies exact artifact bytes and actual package identity before importing
native generated handlers; generator main no longer imports flow first. Four
golden changes were reviewed: only main and its lock hashes changed; IR identical.
Compiler38 groups PASS /14.989s. RSS22/broker143 PASS /33.662s includes per-packet
map validation and pre-dispatch cancellation; those new backend changes still
need latest-source actual ROS regression (older Hold/Cancel reports remain scoped).

Report: M25-rfrt-checkpoint.json. Runtime tests include real typed gRPC fixture
transport, installed-wheel CLI, actual subprocess SIGTERM, bounded stdin events,
correlated release failure, parallel cancellation and identity loss. These are
not actual broker/mock conformance or live generated application acceptance.
T06 local PASS, new source CI pending. Next: T07 fixed12-case real broker/mock
matrix twice, then T08 actual ROS generated apps and freshness/clock/epoch gates.
M26 UI/deployment, M27 full continuous video and hardware remain OPEN.

T07 additive observability: structural task cancellation is not itself a physical
result. `target_release_result` records only the actual correlated inspection
(execution/owner/fence/last target sequence, physical phase and confirmation),
retaining the originating node context. Tests assert that proof precedes the
next body operation; global Stop remains separate and never fabricates Hold
release. Runtime58 groups PASS /10.751s for wheel82cd6e44.
