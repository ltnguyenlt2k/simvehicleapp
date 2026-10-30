# Protobus tools

Use `python -m pbctl --help` inside the Protobus image. The bus defaults to
`127.0.0.1:55600`; set `--bus protobus-sim:55600` from the isolated Compose network.
Reads: `describe`, `get Robot.Safety.Mode`, and `subscribe Robot.Safety.Mode --count 3`.

Control requires a private local file: `--lease-file /tmp/operator-lease.json lease
acquire`. Reuse that option for `lease renew`, `lease release`,
`set Robot.Motion.Velocity --value '{"LinearX":0.1,"AngularZ":0}' --hold-ms 500`,
`set Robot.Motion.Velocity --release`, or `invoke Robot.Safety.Arm`.
`invoke Robot.Motion.Perform --args '{"Name":"BOW"}'` streams lifecycle results;
the robot must already be armed in MANUAL. `cancel <execution-id>` requests
cancellation; only provider feedback confirms completion. `stop` needs no lease.
STOP receipt and robot confirmation are distinct fields. This is a software STOP.

Writes support the local SIM v1.5 protocol and require the matching catalog.
`pbctl inspect <execution-id> --epoch <broker-epoch>` reads the correlated logical
and physical release state without acquiring a lease. STOP replies identify their
own execution so delayed confirmation can be inspected. Missing/evicted IDs and
wrong epochs fail; latest status is never substituted. Protocol v1.5 live
requalification is required before replacing an already running v1.3 stack.
`describe` includes the actual provider kind, mapping/profile hash, measured
adapter source/lock identity and provider session. ROS also advertises observed
Brain, scene and string map-generation identities plus effective Arm permission.
Mock explicitly identifies its synthetic model and cannot claim physical-map
context. A mapping/map/context change ends the old session and authority;
running applications must stop and require a new explicit launch with a matching
deployment binding. These metadata checks do not prove sensor or motion accuracy.
Tokens stay in a mode-0600 file and are omitted from normal output. Lease renewal
runs only during an active set/invoke command. A single `set` expires at catalog
TTL unless refreshed; `--hold-ms` refreshes then explicitly releases the target.
Do not run concurrent writers against the same lease file. Exit codes: 0 success,
2 input/transport error, 3 invocation ended without SUCCEEDED.

`python -m mock` is a synthetic unicycle provider, initially DISARMED. Its isolated
MockControl API supports idle reset and typed scenario scheduling. It never
represents ROS/MuJoCo or hardware validation; live adapters do not expose it.
