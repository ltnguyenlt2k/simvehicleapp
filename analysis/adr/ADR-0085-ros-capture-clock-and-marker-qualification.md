# ADR-0085: Original ROS capture, progressing clock and real marker observations

Status: T08 implementation design, 2026-10-31. Live qualification pending.
Related:0067/0069/0084. T07 edff6d7f CI passed; fresh-host gate is being rerun.

Native RW-A requires Marker.Count from actual image inference. Current mapping
omits it; producer perception/state includes objects[].class_id and original
capture_stamp. issued_at_ns is result publication time and cannot renew an old
image's freshness. Current bridge readiness checks clock message arrival rather
than progress, and backend quality checks host receipt age alone.

Use a pure clock progression guard: require advancing ROS values, expire frozen
repeats, latch regressions until explicit source-epoch reset. Compare host receipt
and authority deadlines only to host monotonic time; compare captures only to ROS
time. Stop/Disarm remain dispatchable when ordinary readiness is lost. Brain
frame ROS age must also be fresh, not merely recently received.

Mapping reset records the first validated new Brain capture as a lower bound.
Reject older epoch captures and future captures before advancing ordering state.
The actual world-reset producer preserves elapsed ROS time; validate that behavior
and clock-reset/restart cases. Callback ordering can temporarily deliver a capture
ahead of the local clock; keep it unknown/rejected until justified by actual clock,
never mark future data fresh. Measure nominal rates before accepting this policy.

Prefer capture_stamp sec/nanosec whenever present; malformed original metadata
never falls back to issue time. Add a closed count_where transform filtering
class_id == red_sim_marker. Empty valid detections mean0; malformed/missing data
mean NONE. No mock API or fabricated sensor success enters the live adapter.

Mapping/context changes require explicit target recording; source/session loss
never resumes an old run. Verify unit negatives, actual CycloneDDS transport,
original capture equality, pause/freeze/epoch faults, latest-source Hold/Cancel,
then native RW-A..D on Brain/MuJoCo. Hardware remains outside these SIM gates.
