# ADR-0073: Shared provider authority kernel and isolated mock scenario RPC

- Status: Accepted under PO delegation 2026-10-29; M23-T06.
- Related: ADR-0066, 0069–0072.

## Decision

ProviderClient is ROS-free wire/authority code within the Protobus module. Mock
and future ROS adapter backends share receive-side epoch/fence/sequence/deadline,
cancellation tombstones, independent Safety channel and watchdog policy. They do
not share kinematics/physics or import vehicle product code. Backend callbacks
must distinguish proven pre-admission rejection from unknown physical failure.
Unknown failure never fabricates physical confirmation. A new lease cannot
inherit old target motion or an old, longer deadline. Loss/reconnect never arms.
Capture metadata can preserve actual ROS stamp/clock/epoch; receipt time cannot
replace a sensor's capture time in the future ROS adapter.

The mock is explicitly kinematic, with a unicycle model and declared battery,
contact and scalar assumptions. Default five motion durations use the recorded
M22 measurements; recovery is a labelled synthetic model. Unit tests may inject
a separate declared short-duration profile. This does not prove physical parity.
V0.1 timeScale remains exactly 1. Configured routes are versioned profile data;
unknown route IDs are rejected instead of inventing a path.

An additive, separate protobus.mock.v1.MockControl service exposes Reset and
Schedule only on the isolated mock network. T08 adds a read-only State RPC on
that same mock-only service to observe its actual synthetic state independently
of broker availability; it labels its model and exposes no lease token. This is
never a live adapter API. It uses typed sensor/result steps,
bounded horizon/count and closed result kinds. No safety/connection state forgery
or safety-command result override is allowed. Schedule atomically replaces the
previous input schedule and clears its overrides/result queues. Reset requires
idle state/no active lease, clears state and reconnects with a new source session.
The live ROS adapter never registers this service. Studio's eventual scenario.v1
maps to this API plus runner events; no HTTP-only test counts as robot evidence.

## Verification

Actual broker/provider RPC integration: DISARMED startup, admission guards,
velocity-to-pose, independent target/lease expiry, five command lifecycles,
measured default BOW duration, scenario timing/failures, Stop confirmation,
reordered stale dispatches, new fence isolation and network loss/no auto-resume.
Pure guard tests cover deadline/fence/cancel edge cases. M24 remains required for
ROS/Brain/physical simulation proof and M27 for the complete user journey/video.
