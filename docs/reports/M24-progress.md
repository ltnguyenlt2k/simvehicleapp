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