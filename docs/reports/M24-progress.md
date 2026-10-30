# M24 execution

Prerequisite: M23 scoped gate PASS at 62529137, Robotics CI 40896228193.
General vehicle CI was still queued at that checkpoint; no success claimed.

## T01 — ROS provider image, in progress

Uses the same pinned Humble/Jammy base as M22 and the message-only Apache export
from dog source 25b4bfad. The image builds dog_interfaces before installing pinned
Protobus dependencies into a separate target directory; it imports the shared
provider kernel on Python 3.10 without copying dog runtime implementation.
The default smoke initializes CycloneDDS and imports message type support without
publishing robot commands. It does not establish real dog transport or motion.

Local build/smoke evidence: robotics/runtime/m24/image-build.log and image-smoke.log
(currently running). Image CI is required before T01 closure and T02 mapping.
Actual Brain authority, live adapter, mapping, safety faults and 30-minute live
acceptance remain OPEN. Hardware/Jetson validation remains outside this gate.

T01 retained failures/corrections:
- Python 3.12 broker lock cannot install rpds-py 2026.9.1 on Humble Python 3.10.
  Official metadata https://pypi.org/pypi/rpds-py/2026.9.1/json declares >=3.11;
  https://pypi.org/pypi/rpds-py/0.30.0/json declares >=3.10 with a cp310 Linux wheel.
  Bridge runtime gets its own pinned lock, rpds-py 0.30.0. Initial 10-package
  compatibility-lock OSV scan found no issues; final split locks require scans.
- Humble setup.bash uses unset optional shell variables; source its setup before
  enabling nounset, retaining errexit/pipefail. Original smoke failure retained.
- Image pip check found colcon-core 0.21.3 requires setuptools<80, while protoc
  tools need setuptools>=77.0.1. A downgrade to 79.0.1 was not adopted: official
  PyPI metadata already reports a vulnerability. Instead protobuf build tooling
  is installed in a temporary build-only target with secure 84.2.1 and removed
  in that same layer after generation. Runtime lock omits grpcio-tools/setuptools,
  leaving the distro colcon environment intact. This separates build tooling
  from ROS/runtime dependency discovery, rather than hiding the conflict.
Logs: image-failed-python310-dependency.log, image-failed-ros-setup-nounset.log,
image-failed-setuptools-colcon-conflict.log. No gate or assertion relaxed.
T01 final local image PASS: sha256:0c28200aca2c81d15a71b221989b808a0abd5d0b7958976a8efb355bb39982d0.
Read-only, network-none, non-root capped smoke imports all four pinned custom
messages, checks every source checksum and canonical catalog hash, initializes
CycloneDDS, and imports shared provider on Python 3.10.12 / grpcio 1.85.0.
Final pip check: No broken requirements found. Final OSV scan: 8 runtime and 5
build entries, No issues found (application locks only, not an OS-wide CVE scan).
The loopback multicast notice is expected with network none; no robot transport
or actuation is claimed. Image build/import/pip-check and both locks are added
to Robotics CI. T01 CI still pending; T02 has not started.
T01 closed: Robotics CI 40897932686 SUCCESS and general CI 40897932762 SUCCESS at f4f6a382; nightly 41028473645 SUCCESS. T02 mapping starts 2026-10-30. No actual dog command transport accepted yet.

## T02 mapping — local PASS, 2026-10-30; CI pending

Closed transform engine, canonical immutable profile hash, catalog/path/control
field validation, per-signal rate limits and capture/epoch-preserving samples.
ROS subscriptions select declared QoS/types and use one bounded latest-message
mailbox per topic; all mapping/store mutation runs on the provider asyncio loop.
No publisher is created. The dog profile declares 31 sensor mappings. Replay of
actual recorded DDS fixtures produces 30 OK and one NONE (unknown charging
status), with SOC converted fraction-to-percent and pose taken from odometry.
Joint/foot named arrays and marker signals remain for validated adapter work;
no values are fabricated for unmapped paths. Remote Arm remains disabled.

Final local checks: **92 broker/provider/mapping tests PASS / 26.552 s** on Python
3.12; **11 mapping tests PASS / 0.109 s** on Humble Python 3.10; **2 actual rclpy /
CycloneDDS fixture tests PASS / 0.342 s**, network isolated from the dog. The latter
verify actual discovery/receipt and capture freeze behavior, plus a separately
labelled 1000-callback bounded-mailbox injection (not 1000 DDS deliveries).
Precheck/diff checks PASS. Logs: mapping-final-tests.log,
mapping-python310-final-tests.log, mapping-ros-final-tests.log under runtime/m24.

Actual ROS test exposed NumPy scalars in fixed covariance arrays after adding
ROS unavailable-component checks. Normalize trusted ROS array containers to
native scalars; unknown covariance still yields NONE. Original failure retained
at mapping-failed-ros-covariance-scalar.log. A later test edit grouped a NaN case
with unrelated negative cases; fixed test grouping, retained mapping-failed-test-grouping.log.
No assertion, safety threshold or availability rule was loosened. CI now runs
both mapping suites in the Humble image. Live dog equality/authority/motion and
M24 overall acceptance remain OPEN; T03 is next.
T02 CI checkpoint: Robotics run 41052808838 SUCCESS at 68a9a7f0, including all
mapping and actual isolated DDS suites. General CI 41052808854 FAILED only the
studio image/E2E job 124052869502, at its M1/M2/M3 Playwright step. Public job
annotations expose only exit code 1; the browser requires sign-in for detailed
logs. No credentials were extracted. Local reproduction of the identical test
selection is running against the existing vehicle Studio, with output under
runtime/m24/general-ci-e2e. This failure is not marked resolved or silently retried.
T03 Brain authority is being implemented independently in the dog repo under
ADR-0020; its initial 8 model + 2 actual DDS checks passed, complete affected
ROS/physics regression is running. M24 overall/live gate remains OPEN.
Producer checkpoint: dog cbd1a48 / image 923b0cb7 qualified Brain authority core
with 173 PASS / 1 profile-only skip, separate fault 1 PASS and targeted actual DDS
3 PASS including physical BOW cancellation. Source equivalence hashes recorded in
the dog repo. Import only its unchanged public controller schema with exact
commit/SHA256, Apache license and NOTICE; no runtime source. ADR-0075 governs the
consumer implementation. T03 adapter now starts; combined live gate remains OPEN.

General-CI investigation: first local diagnostic used localhost:3000, which this
host assigns to OTA rather than Studio; its missing signup field is invalid
Studio evidence, retained under general-ci-e2e/run.log. Corrected to actual
Studio origin localhost:3100 after checking container port/auth URL. The same
non-live/non-restart selection then passed **45/45 / 8.3 min** on the existing
local Studio. This does not identify the original CI failure's cause. Public
artifact download returns 401, and browser logs require sign-in; no credentials
were read. Added Playwright's built-in github reporter, verified against the
installed pinned 1.63.0 implementation; GITHUB_WORKSPACE=/repo makes annotation
paths match repo files. No retry, assertion or timeout change. The next CI must
requalify; any failure will expose its actual test/error in check annotations.
T03 wire/identity kernel increment: consumer imports only the exact producer
schema (3 integrity/negative wire tests PASS), no Brain implementation. Pure
request builder enforces source/epoch/host/deadline/grant/sequence identity and
prohibits provider access to the legacy operator path except STOP/Disarm.
Correlators require request/motion or stable mission IDs, source scene/config,
fresh capture and map generation for success. No physical confirmation is implied
by a parser error or pure terminal match; the actual backend must observe release.
Nine synthetic protocol boundary tests PASS on Python 3.12 and Humble Python 3.10;
full local suite 104 PASS / 29.276 s before the final error-class clarification
(no behavior change). No ROS command publisher/backend is implemented in this
consumer increment yet. T03 and the M24 live gate remain OPEN.

Studio investigation update: the focused reporter run reproduced M1's global
New chat assertion matching the legitimate M10 assistant button after async
status load. Corrected to the Workspace sidebar, explicitly opened the assistant
and retained its own New chat button. Focused PASS and all 4 M1 gates PASS /17.2 s;
previous full selection 45/45 PASS. ee7d75c2 pushed with github annotations and
correct Docker workspace paths; current general CI must requalify. Original CI
artifact unavailable, so no claim that its exact failure was identical. Detailed
report: 2026-10-30-studio-ci-gate.md. No retries/timeouts changed.
General CI 41057143537 SUCCESS at ee7d75c2 after the sidebar gate/annotation fix.
The earlier 68a9a7f0 failure and local traces remain retained. No retries enabled.

T03 actual independent ROS link increment: the consumer image connects through
its own Docker/DDS participant to dog-ros2-r1_robot/domain 52, using only the
pinned public wire schema. It imports no dog implementation. A bounded mailbox
hands metadata/ACKs to the asyncio owner loop; the only publisher is
/dog1/control/request. ACK identity/epoch checks do not fabricate physical results.
The tracked profile and default Arm flag remain disabled; the explicit SIM probe
uses an in-memory authorized profile plus a separate runtime flag.

Actual live link probe PASS: 31 mapped observations, 30 available, unknown battery
charging stays NONE; explicit Brain claim and Arm, 0.3 m/s manual requests,
**0.182524813 m measured odom displacement**, renewal without manual refresh ->
safe output zero within the 0.5 s observation bound, STOP -> SAFE_STOP, sole safe
command writer observed, finally Disarm. Test profile hash
fa73ae5167c98893af0326a4f43feacef2c8e19196506ac92dc83c0273de355d.
Logs: dog-link-live-final.log and dog-link-build.log. This is actual DDS/physics
link evidence only, not broker-provider command completion or workflow acceptance.
The backend lifecycle/lease integration, complete faults and 30-minute live gate
remain OPEN. No video is claimed for this increment.

T03 broker/backend increment: independent Python 3.12 broker -> Humble provider ->
actual Brain -> MuJoCo passed ResetStop/Arm, velocity with measured odom
displacement **0.208710416 m**, BOW PENDING/ACCEPTED/RUNNING/SUCCEEDED and confirmed
STOP (`backend-live-probe-final.log`). This is an increment, not M24 acceptance.
Test-only dual-network Compose is not production T05. Runtime logs stay ignored.

Failures retained: root-owned audit tmpfs caused fail-closed STOP (fixed explicit
uid/gid, audit still enabled); a downstream physics rejection after Brain ACK
exposed an illegal ACCEPTED->REJECTED transition (now FAILED with actual reason);
accumulated movement correctly hit the courtyard spawn guard; reset before sensor
readiness correctly rejected ResetStop. A host-only fixture now resets SIM and
waits for actual ready/nav-ready/new-scene state without arming or retrying rejected
control. Repeated BOW after locomotion exposed that low base speed alone does not
prove stationary joints. Provider preflight now observes joint/base/gyro/contact/
height/upright stability before dispatch; physical admission remains authoritative.
Expanded BOW/LIFT/JUMP live requalification is IN_PROGRESS; failed logs retained.

Backend unit fixtures cover stale capture age, unavailable STOP dispatch, rejected
physical admission after ACK, exact configured route binding, disabled Arm and map
generation changes (6 PASS). Full broker/unit suite **110 PASS /29.794 s** before
the subsequent stricter physical stance preflight. Fixtures are not ROS acceptance.
Authority claim pins scene/map generation; renewal loses authority and navigation
rejects reinterpretation if the map changes. No automatic reclaim or arm. T04–T07,
30-minute live gate and final workflow video remain OPEN.

Expanded positive gate PASS on actual broker/ROS/physics:
`backend-live-navigation.log`, **0.220141416 m** measured odom displacement,
Arm, BOW, LIFT_FRONT_LEFT, JUMP and fixed courtyard map-frame GoTo all SUCCEEDED;
motion/navigation each observed ACCEPTED/RUNNING before confirmed completion.
Standing preflight now requires finite 12-joint velocities, base/gyro/contact/
height/upright stability, allowing up to 5 s within the existing 15 s motion
deadline for the qualified 2 s zero-input/standing-blend controller transition.
No producer admission thresholds or timeouts were changed.

Actual STOP during RUNNING BOW PASS (`backend-stop-motion-final.log`): immediate
logical CANCELLED remains physical_confirmed=false; independent safety status
later reaches SUCCEEDED only after actual recovery/no active motion. Original
test wrongly required the early logical terminal to be physical; that failed
test is retained and corrected to verify both boundaries separately. Full `sr
test` PASS: RSS 20, Protobus 110 /29.635 s before the additional moving-joint
regression. T03 local positive requirements met; T04 still IN_PROGRESS.

Current committed-source CI 86fdc758: general 41060689292 SUCCESS, Robotics
41060689277 FAILED in `sr test`, without detailed public annotations. The same
local selection passes; exact CI cause is unresolved, not presumed transient.
Foundation logs now retained and failed traceback surfaced as check annotations;
the next candidate must requalify before M24 closure.

Process-fault increment: bridge SIGKILL while actual safe velocity was 0.3 m/s
PASS. Independent read-only DDS observer measured safe output zero after
**0.284843220 s**, then 1.5 s no automatic motion, SAFE_STOP and no Brain owner;
sole safe-command writer remained one (`fault-bridge-kill-final.log`). Initial
host fixture used Compose kill by service and also killed its one-off observer;
retained as invalid evidence, fixed to a verified exact long-running container
(project/service/oneoff labels checked). No runtime socket mount or broad kill.
Broker kill is still running. Fresh Python 3.10 backend policy suite 7 PASS;
Python 3.12 full suite 111 PASS /30.523 s. Hardware remains unvalidated.

Broker SIGKILL increment also PASS (`fault-broker-kill.log`): independent actual
DDS safe output zero **0.081096874 s**, 1.5 s no automatic motion, SAFE_STOP/no
owner, sole writer one. These are bounded observations from cutoff before the
host kill request; they are not hard realtime or stopping-distance claims.
Both services restored after each fault. Wrong-hash/ACK-loss/source/epoch cases,
post-reconnect explicit recovery and the sustained live gate remain required.

T04 local gate PASS: actual wrong-config message dropped before admission (no
ACK, as producer envelope contract requires); expired controller rejected;
destroying the real ACK subscription before an actual admitted claim causes
timeout, never false success; Brain grant expires with SAFE_STOP/no owner,
no pending requests or auto Arm (`protocol-fault-live-final.log`). Initial test
incorrectly expected a rejection ACK for an envelope-filtered hash; retained.
Runtime provider application publisher is only control/request (ROS parameter
events are infrastructure); static AST guard also checks the single writer.
ROS-network loss while moving -> safe zero **0.277966895 s**, reconnect/recreate
remains SAFE_STOP/no owner (`fault-ros-network.log`). Actual SIM scene change
while controlling -> safe zero **0.188654850 s**, new scene observed, old broker
lease rejected, restore without auto Arm (`fault-scene-epoch.log`).
Earlier complete process/DDS policy cases and source pins remain applicable.

33a94732 CI: Robotics **41078050281 SUCCESS**, general **41078050352 SUCCESS**.
The preceding 86fdc758 sr-test failure remains unreproduced locally; no claim of
a diagnosed transient cause. Current complete scoped CI requalifies that source.

T05 production profile local PASS: `sr build --live`, precheck/config and `sr up
--live` start only catalog-init/live broker/Humble provider, both healthy, separate
network/audit, no socket, localhost port declaration. `sr pbctl --live describe`
reports actual dog online. Default remote Arm rejection PASS while ROS connected;
explicit SR_AUTHORIZE_SIM_ARM=true permits only later explicit invocation.
Actual production-profile Arm/velocity (**0.211312158 m** odom)/BOW/LIFT/JUMP/GoTo/
STOP all PASS (`live-profile-commands.log`). CLI invalid true/false boundary and
isolated DDS mapping: 4 PASS /2.381 s. README/user guide updated; video still OPEN.

T06 exact-capture comparison PASS: independent read-only raw DDS subscriber vs
live broker, **21 sensor paths /129 comparisons**, tolerance 1e-8 absolute/relative,
same original ROS timestamps, unknown battery charging stays NONE. No mapping
engine reused to calculate expectations. First fixture used the wrong protobuf
oneof name; failed log retained, corrected to the actual contract `kind`.
`live-sensor-equality-final.log` stores values/stamps. Fixed 30-minute telemetry/
resource criteria in M24-live-soak-plan.md before starting the live soak. Four
subscribers and actual PID-1 RSS/Docker memory recording now IN_PROGRESS.
M24 closure and final workflow/video remain OPEN.
