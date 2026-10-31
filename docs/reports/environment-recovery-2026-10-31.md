# Environment recovery — 2026-10-31

Canonical repositories now live at D:/02_Projects/04.dog-ros2-simulation and
D:/02_Projects/09.simvehicleapp. Old D:/03.CTE-DEV and Ubuntu-Recovered are absent.
The replacement distro is Ubuntu-24.04 (24.04.5 LTS), Linux6.18.54.1 WSL2,
Python3.12.3, Docker29.9.2 and Compose5.6.1. Docker was installed from the official
Docker apt repository. No old running containers/images were available.

Historical test reports retain their
original scope; they do not qualify this fresh environment.

Consumer source at edff6d7f had both Robotics41172390042 and general41172389977
CI SUCCESS. Uncommitted T08 clock/capture/marker work from the old Linux workspace
is absent from the migrated consumer checkout and must be reimplemented/tested.
Dog source at0e33ef6 retains the uncommitted ADR0021 battery-input design.

Recovery changes: PowerShell/measurement wrappers use the default WSL distro,
not a deleted hardcoded distro. Doctor passes on the new distro. Robotics text
build inputs use LF consistently across Windows/Linux; pinned interface/wire/
license checksum and independent dependency guards PASS. Provenance JSON line
endings normalize without changing its recorded source/checksums.

Fresh consumer checks: broker144 PASS /30.120s, compiler38 PASS /10.912s,
installed runtime58 PASS /7.501s. RSS checks also passed in the foundation command.
Actual12-case conformance twice is running; exact new package/image hashes and
results will be recorded after completion. Dog vendored source/license/hash
checks PASS; fresh ROS/MuJoCo image build is running. No new ROS acceptance yet.

Next: complete fresh conformance and simulator startup/regression; implement and
qualify T08 original capture/advancing clock/real marker and bounded battery input,
then native RW-A..D, Robot Studio deploy/Robot Zoo Start/status/Stop, complex live
E2E and continuous full-flow video. Hardware/Jetson remain outside SIM acceptance.


Fresh-host conformance first run failed the lease-loss Stop assertion. Actual
trace showed the runtime correctly retained an unconfirmed Stop on source/receipt
mismatch rather than accepting a new provider session's receipt. The original
fixture assumed the provider never restarted during lease expiry. Revised probe
still requires confirmed correlated Stop for an unchanged source; if it changed,
it requires a different observed session, an independently observed fresh safe
mode/zero velocities, inactive motion and connected mock state. It explicitly
retains oldStopConfirmed=false and rejects automatic authority recovery. This is
new-source safe-state evidence, never old-operation completion. Targeted real
broker/mock recheck PASS. Full two-round gate is rerunning; no runtime correlation
check or safety threshold was relaxed. First failure logs retained under
robotics/runtime/recovery/failed-conformance-1. Gate now retains service logs
before teardown for diagnostics. Native ROS/hardware scope remains unchanged.


Fresh recovery gate PASS:12/12 twice,19 detailed cases each,
73.8085s/94.4720s. Exact image/package/case results
and tested provider hash: environment-recovery-checkpoint.json. Provider147 PASS
/32.519s after3 deterministic terminal-ACK/handover tests. Replacement telemetry
must be actually OK before assertions; connection alone is not sensor readiness.
An unchanged source still requires confirmed Stop; changed-source observation
keeps the old Stop unconfirmed. Original failures retained, including expected
unconfirmed shutdown and initial NONE snapshot. No old completion reclassified.
Simulator7 services healthy at8092/domain52. Full ROS baseline173 PASS/1 FAIL/
1 skip (680.38s). Failed motion-STOP fixture had BOW physically REJECTED for
incomplete stationary stance, before STOP. Fresh stable post-Arm physical
predicates and bounded same-grant renewal added to fixture; runtime guards
unchanged. Three independent actual rechecks PASS; affected integration running.
