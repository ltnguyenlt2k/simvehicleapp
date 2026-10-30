# M24 live soak — fixed before measurement

Scope: actual dog ROS/MuJoCo telemetry -> Humble adapter -> independent broker,
30 minutes, timeScale=1, four concurrent subscribers. No workflow acceptance or
hardware claim; robot remains stopped. Images/commits/container caps and host RAM
are recorded. Do not substitute an abbreviated run for this gate.

Representative unique source-capture rates per complete 60-second window:
IMU angular X and odom position X >=12 Hz; Brain mode and sim time >=8 Hz;
battery voltage 0.8..1.2 Hz; other paths <=21 Hz (profile ceiling 20 Hz plus window boundary).
These bounds allow source cadence, max-rate sampling and coalescing; delivery of
repeated source captures does not increase the unique rate. No non-OK quality or
receive gap >0.5 s for high-rate streams or >1.5 s for 1 Hz battery after initial snapshot.
Count distinct source captures through Get, polled every 20 ms by each client;
Subscribe is on-change per ADR-0066, so constant values do not imply frozen data.
Each client also maintains a real on-change subscription and validates quality.
Every subscriber must see >=20 mapped available paths and the same source epoch;
no provider disconnect or audit failure. Per-window rates must stay >=75% of
their first complete-window rate as well as meeting absolute bounds.

Read actual PID-1 VmRSS for broker/provider every 30 s and Docker-reported memory for the
nine dog/live services. After 120 s warmup, each Python service final RSS may grow
at most 16 MiB from warm baseline and fitted slope <=0.5 MiB/min. Report all raw
samples, maxima and summed memory/caps; never claim an 11 GB host envelope if the
actual host memory differs. RSS and Docker-reported memory (cgroup-derived with
inactive file cache excluded by Docker) are distinct measurements. A failed
run remains evidence and requires a concrete fix before requalification.

Measurement correction before run02: the first 60-second attempt wrongly counted
on-change events as capture rates and failed constant Robot.Safety.Mode (one event).
The test failure and resources remain under runtime/m24/live-soak. No runtime
change or threshold change; run02 measures the actual record capture stamps.

Source-cadence correction before run03: run02 caught a second erroneous fixture
assumption (battery >=3 Hz /gap <=0.5 s). Producer cbd1a48 sim.py publishes battery
only at `count % 100 == 0` on its 100 Hz tick, i.e. 1 Hz; RSS explicitly permits
2500 ms age. The old criteria cannot pass the valid source contract. Corrected
battery-only bounds to 0.8..1.2 Hz /1.5 s gap, before run03. Other rate, latency,
memory and 30-minute requirements remain unchanged; no producer/adapter change.
Both invalid measurement attempts are retained, never counted as passing soaks.
