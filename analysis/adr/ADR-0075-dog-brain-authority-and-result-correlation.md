# ADR-0075: dog-control/1 Brain authority and actual result correlation

Status: Accepted under user delegation, 2026-10-30; M24-T03 implementation.
Producer contract: dog repo ADR-0020 at cbd1a48. Prerequisite M23 scoped PASS.

The ROS provider consumes the versioned dog-control-authority.v1 wire schema,
exported unchanged with commit/hash/license provenance. No Brain/runtime source
is imported. Messages remain schema-1 JSON control/request; the ROS boundary uses
JSON integer timestamps/sequences, while Protobus public protobuf JSON keeps its
int64 decimal strings. Both sides share the same Linux monotonic clock domain.

Brain grants source/session ownership only while healthy and DISARMED. Requests
bind Brain boot, scene, host clock, grant, strict sequence and bounded absolute
validity. Renew does not refresh velocity. STOP/Disarm remain operator overrides;
expiry/revocation rotates a challenge to reject old queued acquisition requests.
The provider must not automatically reclaim/reset/arm after reconnect. Remote Arm
requires an explicitly authorized SIM profile; the tracked default remains off.

ACK is admission, not physical completion. Motion results must match motion_id,
scene and current source identity, then actual terminal/recovery state. Navigation
uses stable mission_id, independent of later renewal ACKs, and remote coordinates
require exact current map frame/generation. Unknown/stale results cannot release
broker quarantine or confirm STOP. ROS source capture/availability is preserved.

Producer Brain increment cbd1a48: fresh image 923b0cb7, complete local regression
173 PASS / 1 fault-only skip, separate fault 1 PASS, targeted actual DDS authority
3 PASS including externally owned BOW cancelled by operator STOP. This accepts the
producer increment only. M24 requires the external adapter and complete broker/
bridge/robot fault/equality/soak gate before combined acceptance. Hardware is out
of scope; cooperative ROS ownership is not malicious-writer authentication.
