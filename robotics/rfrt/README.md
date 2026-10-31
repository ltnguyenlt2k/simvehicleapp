# RobotFlow runtime development preview

`rfrt` runs native generated async Python through typed Protobus only. It contains
no ROS, broker, provider or compiler implementation. Importing the package does
not open a connection, take a lease or Arm a robot. Application import follows
exact file/hash/runtime/target verification. Deployment and launch are separate.

From the repository root, offline developer checks:

```sh
bash robotics/scripts/sr build
docker compose -f robotics/compose.yaml --profile compiler-tools build robotflow
docker compose -f robotics/compose.yaml --profile runtime-tools build rfrt
docker compose -f robotics/compose.yaml --profile runtime-tools run --rm --no-deps rfrt
docker compose -f robotics/compose.yaml --profile runtime-tools run --rm --no-deps rfrt python -I -m rfrt --runtime-info
```

The runtime-tools profile has no network. These commands do not execute a live
workflow. Bus-connected CLI integration and live generated applications are the
later M25-T07/T08 gates; Robot Studio/deploy/full video remain M26/M27.

The image builds the actual 0.1.0 wheel twice with fixed timestamps, compares
bytes, installs it and tests the installed package. Hash identity lives outside
the wheel at `/opt/rfrt-runtime/package.sha256`. JSON schemas and proto artifacts
are inside the wheel. No package installation or source download happens at Run.

In a commissioned runner, the entrypoint is `python -I -m rfrt --root APP
--target TARGET --bus BUS`. Target is a closed `rftarget.v1` deployment record;
launch never silently records a new expected target. An absent/mismatched actual
runtime pin fails before connection or code loading. `--max-run-ms` may reduce,
never extend the compiled limit. `--events-stdin` accepts bounded `rfevent.v1`
lines; duplicate identities do not replay. SIGTERM/SIGINT use independent Stop,
await owned cleanup and report unconfirmed shutdown as failure.

Hold starts its duration after backend admission, refreshes complete values,
then confirms the same owner's safe release before another body operation.
Losing parallel children retain their command stream while requesting Cancel,
so a structural cancel does not become an accidental stream-loss revocation.
Unknown physical completion triggers Stop; it cannot permit another motion.
No session/lease loss automatically reacquires authority, Arms or replays.

Scoped acceptance and unresolved work are tracked in
[M25 progress](../../docs/reports/M25-progress.md). Fake typed-server unit tests
are separate from actual broker/mock conformance and ROS/physics qualification.
