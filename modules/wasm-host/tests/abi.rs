//! sv-wasm-abi/1 on the host (M20-T03): guests written in WAT exercise every import, the allowlist, the cache of
//! `vdb_current`, the limits and `.cwasm` handling.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use sv_wasm_host::abi::{self, Fault, Host, Limits, Line};
use sv_wasm_host::allow::Allowlist;
use sv_wasm_host::vehicle::{MockVehicle, Request};

/// The common part of the test guests: memory with the strings, a bump allocator, imports.
const PRELUDE: &str = r#"
  (import "sv" "now_ms" (func $now (result i64)))
  (import "sv" "log" (func $log (param i32 i32 i32)))
  (import "sv" "trace" (func $trace (param i32 i32)))
  (import "sv" "vdb_subscribe" (func $sub (param i32 i32 i32 i32) (result i32)))
  (import "sv" "vdb_current" (func $cur (param i32 i32 i32 i32 i32 i32) (result i32)))
  (import "sv" "vdb_set" (func $set (param i32 i32 i32 i32 i32 i32) (result i32)))
  (import "sv" "mqtt_publish" (func $pub (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 2)
  (global $heap (mut i32) (i32.const 4096))
  (global $events (mut i32) (i32.const 0))
  (data (i32.const 0) "Vehicle.Speed")                                   ;; 0, 13
  (data (i32.const 16) "float")                                          ;; 16, 5
  (data (i32.const 32) "Vehicle.Body.Lights.Hazard.IsSignaling")         ;; 32, 38
  (data (i32.const 80) "boolean")                                        ;; 80, 7
  (data (i32.const 96) "true")                                           ;; 96, 4
  (data (i32.const 112) "Vehicle.Cabin.Door.Row1.DriverSide.IsOpen")     ;; 112, 41
  (data (i32.const 160) "{\"ev\":\"app.started\",\"data\":{\"abi\":1}}") ;; 160, 37
  (data (i32.const 208) "guest up")                                      ;; 208, 8
  (data (i32.const 224) "app/hmi")                                       ;; 224, 7
  (data (i32.const 240) "secret/x")                                      ;; 240, 8
  (func (export "sv_alloc") (param $n i32) (result i32)
    (local $p i32) (local.set $p (global.get $heap))
    (global.set $heap (i32.add (global.get $heap) (local.get $n))) (local.get $p))
  (func (export "sv_free") (param i32 i32))
  (func (export "sv_stop"))
"#;

fn module(body: &str) -> String {
    format!("(module {PRELUDE} {body})")
}

/// The app guest: subscribes to Speed at init; on its first event writes Hazard = true, tries a door it may not
/// write and a topic it may not publish; `sv_step` returns how many events it saw (as the next due time).
const APP: &str = r#"
  (global $r (mut i32) (i32.const 0))
  (func (export "sv_init") (param i32 i32) (result i32)
    (drop (call $sub (i32.const 0) (i32.const 13) (i32.const 16) (i32.const 5)))
    (call $trace (i32.const 160) (i32.const 37))
    (call $log (i32.const 1) (i32.const 208) (i32.const 8))
    (i32.const 0))
  (func (export "sv_on_event") (param i32 i32)
    (global.set $events (i32.add (global.get $events) (i32.const 1)))
    (if (i32.eq (global.get $events) (i32.const 1)) (then
      (drop (call $set (i32.const 32) (i32.const 38) (i32.const 80) (i32.const 7) (i32.const 96) (i32.const 4)))
      (global.set $r (call $set (i32.const 112) (i32.const 41) (i32.const 80) (i32.const 7) (i32.const 96) (i32.const 4)))
      (drop (call $pub (i32.const 224) (i32.const 7) (i32.const 96) (i32.const 4)))
      (drop (call $pub (i32.const 240) (i32.const 8) (i32.const 96) (i32.const 4))))))
  (func (export "sv_step") (param i64) (result i64) (i64.extend_i32_u (global.get $events)))
  ;; the cached Speed into memory at 1024, or the import's code
  (func (export "speed") (result i32) (call $cur (i32.const 0) (i32.const 13) (i32.const 16) (i32.const 5) (i32.const 1024) (i32.const 64)))
"#;

const ALLOW: &str = r#"{"app": "Overspeed", "signals": {"read": ["Vehicle.Speed"], "write": ["Vehicle.Body.Lights.Hazard.IsSignaling"]}, "topics": ["app/"]}"#;

fn fixed_clock() -> (Arc<AtomicI64>, Box<dyn Fn() -> i64 + Send>) {
    let t = Arc::new(AtomicI64::new(0));
    let c = t.clone();
    (t, Box::new(move || c.load(Ordering::Relaxed)))
}

#[test]
fn imports_allowlist_events_and_trace() {
    let (engine, _t) = abi::engine().unwrap();
    let m = abi::load(&engine, module(APP).as_bytes()).unwrap();
    let (clock, now) = fixed_clock();
    let mut host = Host::new(
        &engine,
        &m,
        Allowlist::parse(ALLOW).unwrap(),
        &Limits::default(),
        now,
    )
    .unwrap();
    assert_eq!(host.init(r#"{"app":"Overspeed"}"#).unwrap(), 0);
    let lines = host.take_lines();
    assert!(
        matches!(&lines[0], Line::Out(l) if l.starts_with(r#"SVTRACE {"v":1,"ts":"#) && l.ends_with(r#""app":"Overspeed","ev":"app.started","data":{"abi":1}}"#)),
        "{lines:?}"
    );
    assert_eq!(lines[1], Line::Out("guest up".into()));
    assert_eq!(
        host.take_requests(),
        vec![Request::Subscribe {
            sub: 1,
            path: "Vehicle.Speed".into(),
            ty: "float".into()
        }]
    );

    let mut car = MockVehicle::default();
    car.execute_all(vec![Request::Subscribe {
        sub: 1,
        path: "Vehicle.Speed".into(),
        ty: "float".into(),
    }]);
    clock.store(1000, Ordering::Relaxed);
    for e in car.feed("Vehicle.Speed", "130") {
        host.deliver(&e).unwrap();
    }
    assert_eq!(host.step(1000).unwrap(), 1);
    // the cached value is readable by the guest
    assert_eq!(host.speed(), 3);
    let due = abi::pump(&mut host, &mut car).unwrap();
    // the allowed write reached the vehicle, the door did not (forbidden event), only the allowed topic was published
    assert_eq!(
        car.values
            .get("Vehicle.Body.Lights.Hazard.IsSignaling")
            .map(String::as_str),
        Some("true")
    );
    assert!(!car
        .values
        .contains_key("Vehicle.Cabin.Door.Row1.DriverSide.IsOpen"));
    assert_eq!(
        car.published,
        vec![("app/hmi".to_string(), "true".to_string())]
    );
    // events seen: Speed, set_result ok, set_result forbidden
    assert_eq!(due, 3);
}

#[test]
fn a_call_past_its_deadline_and_a_trap_are_faults() {
    let (engine, _t) = abi::engine().unwrap();
    let spin = module(
        r#"
      (func (export "sv_init") (param i32 i32) (result i32) (i32.const 0))
      (func (export "sv_on_event") (param i32 i32) (unreachable))
      (func (export "sv_step") (param i64) (result i64) (loop $l (br $l)) (i64.const 0))"#,
    );
    let m = abi::load(&engine, spin.as_bytes()).unwrap();
    let mut host = Host::new(
        &engine,
        &m,
        Allowlist::open("spin"),
        &Limits {
            deadline_ms: 50,
            ..Limits::default()
        },
        abi::monotonic(),
    )
    .unwrap();
    assert_eq!(host.init("{}").unwrap(), 0);
    let f = host.step(0).unwrap_err();
    assert_eq!(
        f.downcast_ref::<Fault>().map(|f| f.reason),
        Some("wasm_limit"),
        "{f:#}"
    );
    let f = host.deliver(r#"{"kind":"stop"}"#).unwrap_err();
    assert_eq!(
        f.downcast_ref::<Fault>().map(|f| f.reason),
        Some("wasm_trap"),
        "{f:#}"
    );
    let line = abi::fault_line("spin", f.downcast_ref::<Fault>().unwrap());
    assert!(
        line.contains(r#""ev":"error","data":{"reason":"wasm_trap""#),
        "{line}"
    );
}

#[test]
fn memory_beyond_the_limit_is_refused() {
    let (engine, _t) = abi::engine().unwrap();
    // grows by 2 000 pages (125 MiB): -1 under the default 64 MiB limit
    let grow = module(
        r#"
      (func (export "sv_init") (param i32 i32) (result i32) (memory.grow (i32.const 2000)))
      (func (export "sv_on_event") (param i32 i32))
      (func (export "sv_step") (param i64) (result i64) (i64.const -1))"#,
    );
    let m = abi::load(&engine, grow.as_bytes()).unwrap();
    let mut host = Host::new(
        &engine,
        &m,
        Allowlist::open("grow"),
        &Limits::default(),
        abi::monotonic(),
    )
    .unwrap();
    assert_eq!(host.init("{}").unwrap(), -1);
    let mut big = Host::new(
        &engine,
        &m,
        Allowlist::open("grow"),
        &Limits {
            max_memory_mb: 256,
            ..Limits::default()
        },
        abi::monotonic(),
    )
    .unwrap();
    assert_eq!(big.init("{}").unwrap(), 2);
}

#[test]
fn precompiled_by_this_host_loads_anything_else_is_refused() {
    let (engine, _t) = abi::engine().unwrap();
    let wasm = wat_bytes(&module(APP));
    let cwasm = abi::precompile(&engine, &wasm).unwrap();
    let m = abi::load(&engine, &cwasm).unwrap();
    let mut host = Host::new(
        &engine,
        &m,
        Allowlist::open("app"),
        &Limits::default(),
        abi::monotonic(),
    )
    .unwrap();
    assert_eq!(host.init("{}").unwrap(), 0);
    let other = wasmtime::Engine::new(&wasmtime::Config::new()).unwrap();
    let foreign = other.precompile_module(&wasm).unwrap();
    assert!(abi::load(&engine, &foreign).is_err());
    // a module that misses an export of the ABI is refused by name
    let partial = abi::load(&engine, b"(module (memory (export \"memory\") 1))").unwrap();
    let err = Host::new(
        &engine,
        &partial,
        Allowlist::open("x"),
        &Limits::default(),
        abi::monotonic(),
    )
    .err()
    .unwrap();
    assert!(format!("{err:#}").contains("sv_alloc"), "{err:#}");
}

fn wat_bytes(text: &str) -> Vec<u8> {
    wat::parse_str(text).unwrap()
}

/// Test-only helpers on the types under test.
trait TestExt {
    fn speed(&mut self) -> i32;
}

impl TestExt for Host {
    fn speed(&mut self) -> i32 {
        self.call_i32("speed").unwrap()
    }
}

trait ExecuteAll {
    fn execute_all(&mut self, r: Vec<Request>);
}

impl ExecuteAll for MockVehicle {
    fn execute_all(&mut self, r: Vec<Request>) {
        use sv_wasm_host::vehicle::Vehicle;
        for x in r {
            self.execute(x);
        }
    }
}
