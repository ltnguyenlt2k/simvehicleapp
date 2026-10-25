# sv-wasm-abi/1 — WebAssembly guest ⇄ sv-wasm-host

Status: **draft** (M20-T02, ADR-0061 Proposed). Locks when M20-T08 passes (conformance and parity on `cpp-wasm` and
`rust-wasm`). After lock: a breaking change is `sv-wasm-abi/2` + ADR; the host may serve both.

A generated vehicle app built for the `wasm` target (`backend-capabilities.target.kind = wasm`) is a WebAssembly module
for `wasm32-wasip1`. The host (`sv-wasm-host`, Wasmtime) connects it to the KUKSA databroker (`kuksa.val.v2`), MQTT and
the trace stream, so orchestrator, sandboxes (ADR-0057) and deployments (ADR-0060) treat it like a native app.

## 1. Module shape
- Target `wasm32-wasip1`, *reactor* model: the module exports `_initialize` (C/C++ constructors), the host calls it once
  right after instantiation and before `sv_init`. Rust `cdylib` modules may export it too; the host calls it if present.
- One exported linear memory named `memory`.
- WASI preview 1 is linked for `clock_time_get`, `random_get` (allocators only), `fd_write` to stdout/stderr and
  `proc_exit`. No preopened directories, no sockets, no environment, no arguments.
- C++ guests may use the WebAssembly exception-handling proposal (`-fwasm-exceptions`, new EH, M20-T01 spike); the host
  enables it. No threads (`wasm32-wasip1` has none): the runtime's strand is pumped by `sv_step`.

## 2. Values
- Strings are UTF-8 `(ptr: i32, len: i32)` in guest memory; never NUL-terminated.
- Signal values and events are JSON text with the encoding of writes and trace (ADR-0018): int64/uint64 as decimal
  strings, arrays as JSON arrays.
- Type names are VSS datatypes (`boolean`, `float`, `int64`, `string[]`, …).
- Ids returned by imports are `i32` ≥ 1; a negative result is an error code (§5).

## 3. Imports (module `sv`)
| Function | Signature | Meaning |
|---|---|---|
| `now_ms` | `() -> i64` | Milliseconds since the app started, monotonic (IR `now_ms`, timers) |
| `log` | `(level: i32, msg_ptr, msg_len) -> ()` | 0 debug, 1 info, 2 warn, 3 error |
| `trace` | `(json_ptr, json_len) -> ()` | One trace event (`trace-event.v1` without `v`, `ts`, `app`, which the host adds) |
| `vdb_subscribe` | `(path, type) -> i32` | Subscription id; changes arrive as `signal` events |
| `vdb_current` | `(path, type, out_ptr, out_cap: i32) -> i32` | Cached value as JSON into `out`; `-1` none yet; a result `> out_cap` is the length needed (nothing written) |
| `vdb_get` | `(path, type) -> i32` | Request id; the value arrives as a `get_result` event |
| `vdb_set` | `(path, type, value_json) -> i32` | Request id; the outcome arrives as a `set_result` event. The host checks the allowlist and the type first |
| `mqtt_subscribe` | `(filter) -> i32` | Subscription id; messages arrive as `mqtt` events |
| `mqtt_publish` | `(topic, payload) -> i32` | `0` ok, negative error (§5) |

Each `(path, type)` / `(topic, payload)` pair is four `i32` (two strings).

## 4. Exports
| Function | Signature | Meaning |
|---|---|---|
| `sv_alloc` | `(len: i32) -> i32` | Memory for the host to write a string into; `0` on failure |
| `sv_free` | `(ptr: i32, len: i32) -> ()` | Frees what `sv_alloc` gave |
| `sv_init` | `(config_ptr, config_len) -> i32` | Config JSON `{app, workflows, traceLevel, env}`; `0` ok, else the app does not start |
| `sv_on_event` | `(event_ptr, event_len) -> ()` | One event, JSON (§4.1) |
| `sv_step` | `(now_ms: i64) -> i64` | Runs everything due; returns the next due time, `-1` when nothing is scheduled |
| `sv_stop` | `() -> ()` | Cancels every run, emits `app.stopping` |
| `sv_run_tests` | `(cases_ptr, cases_len) -> i32` | Runs test cases (`scenario.v1` list) on a mock vehicle and virtual clock inside the guest; results through `log`; returns the number of failed cases |

### 4.1 Events
```jsonc
{"kind": "signal", "sub": 3, "path": "Vehicle.Speed", "value": 121, "ts": 1792851821684, "initial": true}  // first value of a subscription: the baseline, like the native prefetch (no trigger)
{"kind": "signal", "sub": 3, "path": "Vehicle.Speed", "value": 131, "ts": 1792851824777}
{"kind": "get_result", "req": 7, "value": 121, "error": ""}
{"kind": "set_result", "req": 8, "error": ""}          // "forbidden", "type", "rejected: …", "unavailable"
{"kind": "mqtt", "sub": 2, "topic": "app/cmd", "payload": "…"}
{"kind": "stop"}
```

## 5. Rules
- **No re-entry:** the guest never calls an import while the host is inside an import call; the host never calls an
  export from inside an import.
- After each `sv_on_event` the host calls `sv_step(now)`; it also calls `sv_step` when the returned due time comes.
- **Limits:** every export call runs under an epoch deadline (default 200 ms) and a memory limit (default 64 MiB,
  `SV_WASM_MAX_MEMORY_MB`). Over a limit the host emits a trace `error` with reason `wasm_limit` and stops the app with a
  non-zero exit code. A trap does the same with reason `wasm_trap`.
- **Allowlist:** `sv-app.json` next to the module lists the paths the app reads and writes and its MQTT topics
  (generated). `vdb_set` outside it ⇒ `set_result.error = "forbidden"`; `vdb_subscribe`/`vdb_get` outside it ⇒ `-2`.
- **Error codes** of imports: `-1` not available yet, `-2` forbidden, `-3` invalid argument (bad UTF-8, unknown type),
  `-4` host unavailable (databroker or MQTT down).
- **Precompiled modules:** `app.cwasm` is produced by the same host binary (`sv-wasm-host --precompile`), with the
  engine configuration it runs with; a `.cwasm` from another build or the Wasmtime CLI is refused (M20-T01).
- **Determinism:** the runtime does not use `random_get` or wall-clock time beyond `now_ms`; trace and writes are the
  same as the native runtime's for the same inputs (conformance, parity P3).

- **Lifecycle:** the host prints `vdb.connected` and `app.started` once every subscription made in `sv_init` has its
  first value (at most 2 s, as the native host); the guest emits `app.stopping` in `sv_stop`.

## 6. Host environment
The host reads the same variables as a native app (`SDV_VEHICLEDATABROKER_ADDRESS`, `SDV_MQTT_ADDRESS`,
`SV_TRACE_LEVEL`; `SV_DATABROKER_API` must be `kuksa.val.v2` when set) and prints `SVTRACE {…}` lines like the native runtimes, so the orchestrator's trace ingest is shared.
