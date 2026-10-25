//! The runtime as a WebAssembly guest (feature `wasm`, ADR-0061, contracts `abi/sv-wasm-abi.v1.md`): the strand runs
//! on a virtual clock that `sv_step` moves to the host's time, signals and MQTT go through the host's `sv.*` imports,
//! trace and logs are handed to the host, which prints them like a native app. A generated app calls
//! [`wasm_app!`](crate::wasm_app) once; the macro defines the `sv_*` exports of the module.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use crate::runtime::{MqttHandler, PubSub, Runtime, TraceRecord, TraceSink, VehicleAccess};
use crate::strand::Strand;
use crate::testing;
use crate::values::{self as v, Value};

/// The host's imports (module `sv`); off wasm32 a recording stand-in, so the adapter is unit-tested natively.
mod host {
    #[cfg(target_arch = "wasm32")]
    #[link(wasm_import_module = "sv")]
    extern "C" {
        pub fn now_ms() -> i64;
        pub fn log(level: i32, p: *const u8, n: i32);
        pub fn trace(p: *const u8, n: i32);
        pub fn vdb_subscribe(pp: *const u8, pn: i32, tp: *const u8, tn: i32) -> i32;
        pub fn vdb_current(
            pp: *const u8,
            pn: i32,
            tp: *const u8,
            tn: i32,
            out: *mut u8,
            cap: i32,
        ) -> i32;
        pub fn vdb_get(pp: *const u8, pn: i32, tp: *const u8, tn: i32) -> i32;
        pub fn vdb_set(
            pp: *const u8,
            pn: i32,
            tp: *const u8,
            tn: i32,
            vp: *const u8,
            vn: i32,
        ) -> i32;
        pub fn mqtt_subscribe(p: *const u8, n: i32) -> i32;
        pub fn mqtt_publish(tp: *const u8, tn: i32, pp: *const u8, pn: i32) -> i32;
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub use super::fake::*;
}

/// Off wasm32: the imports record what the guest asked for (tests).
#[cfg(not(target_arch = "wasm32"))]
mod fake {
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    thread_local! {
        pub static NOW: RefCell<i64> = const { RefCell::new(0) };
        pub static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
        pub static CURRENT: RefCell<BTreeMap<String, String>> = const { RefCell::new(BTreeMap::new()) };
        static NEXT: RefCell<i32> = const { RefCell::new(0) };
    }

    fn s(p: *const u8, n: i32) -> String {
        // SAFETY: the adapter passes pointers into live Rust strings of length n.
        String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(p, n as usize) }).into_owned()
    }
    fn call(c: String) -> i32 {
        CALLS.with(|x| x.borrow_mut().push(c));
        NEXT.with(|n| {
            *n.borrow_mut() += 1;
            *n.borrow()
        })
    }
    pub unsafe fn now_ms() -> i64 {
        NOW.with(|t| *t.borrow())
    }
    pub unsafe fn log(level: i32, p: *const u8, n: i32) {
        call(format!("log {level} {}", s(p, n)));
    }
    pub unsafe fn trace(p: *const u8, n: i32) {
        call(format!("trace {}", s(p, n)));
    }
    pub unsafe fn vdb_subscribe(pp: *const u8, pn: i32, tp: *const u8, tn: i32) -> i32 {
        call(format!("subscribe {} {}", s(pp, pn), s(tp, tn)))
    }
    pub unsafe fn vdb_current(
        pp: *const u8,
        pn: i32,
        _tp: *const u8,
        _tn: i32,
        out: *mut u8,
        cap: i32,
    ) -> i32 {
        let Some(v) = CURRENT.with(|c| c.borrow().get(&s(pp, pn)).cloned()) else {
            return -1;
        };
        if v.len() as i32 > cap {
            return v.len() as i32;
        }
        // SAFETY: the adapter passes a buffer of `cap` bytes.
        unsafe { std::ptr::copy_nonoverlapping(v.as_ptr(), out, v.len()) };
        v.len() as i32
    }
    pub unsafe fn vdb_get(pp: *const u8, pn: i32, _tp: *const u8, _tn: i32) -> i32 {
        call(format!("get {}", s(pp, pn)))
    }
    pub unsafe fn vdb_set(
        pp: *const u8,
        pn: i32,
        _tp: *const u8,
        _tn: i32,
        vp: *const u8,
        vn: i32,
    ) -> i32 {
        call(format!("set {} {}", s(pp, pn), s(vp, vn)))
    }
    pub unsafe fn mqtt_subscribe(p: *const u8, n: i32) -> i32 {
        call(format!("mqtt_subscribe {}", s(p, n)))
    }
    pub unsafe fn mqtt_publish(tp: *const u8, tn: i32, pp: *const u8, pn: i32) -> i32 {
        call(format!("publish {} {}", s(tp, tn), s(pp, pn)));
        0
    }
}

fn now() -> i64 {
    // SAFETY: an import without arguments.
    unsafe { host::now_ms() }
}

fn log(level: i32, text: &str) {
    // SAFETY: (ptr, len) of a live string.
    unsafe { host::log(level, text.as_ptr(), text.len() as i32) }
}

fn import_error(code: i32) -> String {
    match code {
        -2 => "forbidden".into(),
        -3 => "invalid argument".into(),
        -4 => "unavailable".into(),
        c => format!("error {c}"),
    }
}

/// The `bind` of a generated workflow.
pub type Bind = fn(&Runtime);

/// A generated app: its name, trace level, workflows and user hooks.
pub struct App {
    pub name: &'static str,
    /// `off`, `trigger` or `node`.
    pub trace_level: &'static str,
    pub workflows: Vec<(&'static str, Bind)>,
    pub on_app_start: fn(),
    pub on_app_stop: fn(),
}

/// Trace and logs to the host (`sv.trace` without `v`/`ts`/`app`, which the host adds).
struct HostSink {
    level: u8,
}

impl TraceSink for HostSink {
    fn trace(&self, r: &TraceRecord) {
        let lifecycle = r.ev.starts_with("app.") || r.ev.starts_with("vdb.");
        if !lifecycle
            && (self.level == 0 || (self.level == 1 && (r.ev == "enter" || r.ev == "exit")))
        {
            return;
        }
        let mut line = Vec::new();
        if !r.wf.is_empty() {
            line.push(("wf", Value::str(&r.wf)));
        }
        if let Some(run) = r.run {
            line.push(("run", Value::Int(run as i128)));
        }
        if !r.node.is_empty() {
            line.push(("node", Value::str(&r.node)));
        }
        line.push(("ev", Value::str(&r.ev)));
        if let Some(d) = &r.data {
            line.push(("data", d.clone()));
        }
        let text = v::js_json(&Value::obj(line));
        // SAFETY: (ptr, len) of a live string.
        unsafe { host::trace(text.as_ptr(), text.len() as i32) }
    }

    fn log(&self, _ts: i64, level: &str, message: &str) {
        let code = match level {
            "error" => 3,
            "warn" => 2,
            "debug" => 0,
            _ => 1,
        };
        log(code, &format!("[{level}] {message}"));
    }
}

type OnValue = Rc<dyn Fn(Value)>;
type OnGet = Box<dyn FnOnce(Option<Value>, String)>;
type OnSet = Box<dyn FnOnce(String)>;

/// Signals through the host: subscribed at init, answers as events posted to the strand.
struct HostVehicle {
    strand: Rc<Strand>,
    subs: RefCell<BTreeMap<String, (String, Option<OnValue>)>>,
    gets: RefCell<BTreeMap<i64, (String, OnGet)>>,
    sets: RefCell<BTreeMap<i64, OnSet>>,
}

impl HostVehicle {
    fn prefetch(&self, path: &str, ty: &str) {
        if self.subs.borrow().contains_key(path) {
            return;
        }
        // SAFETY: (ptr, len) of live strings.
        unsafe {
            host::vdb_subscribe(
                path.as_ptr(),
                path.len() as i32,
                ty.as_ptr(),
                ty.len() as i32,
            )
        };
        self.subs
            .borrow_mut()
            .insert(path.into(), (ty.into(), None));
    }

    /// A `signal`, `get_result` or `set_result` event; before `start` the first value of a signal is its baseline.
    fn on_event(&self, e: &Value, started: bool) {
        let field = |k: &str| e.get(k).cloned().unwrap_or(Value::Null);
        let text = |k: &str| match field(k) {
            Value::Str(s) => s,
            _ => String::new(),
        };
        let int = |k: &str| match field(k) {
            Value::Int(i) => i as i64,
            _ => 0,
        };
        match text("kind").as_str() {
            "signal" => {
                let initial = matches!(field("initial"), Value::Bool(true));
                let subs = self.subs.borrow();
                let Some((ty, Some(cb))) = subs.get(&text("path")) else {
                    return;
                };
                let value = field("value");
                if !started || initial || value == Value::Null {
                    return;
                }
                let (cb, x) = (cb.clone(), v::from_json(&value, ty));
                self.strand.post(move || cb(x));
            }
            "get_result" => {
                let Some((ty, done)) = self.gets.borrow_mut().remove(&int("req")) else {
                    return;
                };
                let (error, value) = (text("error"), field("value"));
                let x =
                    (error.is_empty() && value != Value::Null).then(|| v::from_json(&value, &ty));
                self.strand.post(move || done(x, error));
            }
            "set_result" => {
                let Some(done) = self.sets.borrow_mut().remove(&int("req")) else {
                    return;
                };
                let error = text("error");
                self.strand.post(move || done(error));
            }
            _ => {}
        }
    }
}

impl VehicleAccess for HostVehicle {
    fn current(&self, path: &str, ty: &str) -> Option<Value> {
        let mut buf = vec![0u8; 256];
        // SAFETY: (ptr, len) of live strings and a buffer of buf.len() bytes.
        let read = |buf: &mut Vec<u8>| unsafe {
            host::vdb_current(
                path.as_ptr(),
                path.len() as i32,
                ty.as_ptr(),
                ty.len() as i32,
                buf.as_mut_ptr(),
                buf.len() as i32,
            )
        };
        let mut n = read(&mut buf);
        if n > buf.len() as i32 {
            buf = vec![0u8; n as usize];
            n = read(&mut buf);
        }
        if n < 0 {
            return None;
        }
        let x = v::parse_json(std::str::from_utf8(&buf[..n as usize]).ok()?).ok()?;
        (x != Value::Null).then(|| v::from_json(&x, ty))
    }

    fn subscribe(&self, path: &str, ty: &str, on_value: Box<dyn Fn(Value)>) {
        self.prefetch(path, ty);
        if let Some(s) = self.subs.borrow_mut().get_mut(path) {
            s.1 = Some(Rc::from(on_value));
        }
    }

    fn get(&self, path: &str, ty: &str, done: Box<dyn FnOnce(Option<Value>, String)>) {
        // SAFETY: (ptr, len) of live strings.
        let req = unsafe {
            host::vdb_get(
                path.as_ptr(),
                path.len() as i32,
                ty.as_ptr(),
                ty.len() as i32,
            )
        };
        if req < 0 {
            self.strand.post(move || done(None, import_error(req)));
            return;
        }
        self.gets.borrow_mut().insert(req as i64, (ty.into(), done));
    }

    fn set(&self, path: &str, ty: &str, value: Value, done: Option<Box<dyn FnOnce(String)>>) {
        let json = v::js_json(&v::to_json(&value, Some(ty)));
        // SAFETY: (ptr, len) of live strings.
        let req = unsafe {
            host::vdb_set(
                path.as_ptr(),
                path.len() as i32,
                ty.as_ptr(),
                ty.len() as i32,
                json.as_ptr(),
                json.len() as i32,
            )
        };
        match (req < 0, done) {
            (true, Some(done)) => {
                self.strand.post(move || done(import_error(req)));
            }
            (false, Some(done)) => {
                self.sets.borrow_mut().insert(req as i64, done);
            }
            _ => {}
        }
    }
}

struct HostPubSub {
    handler: RefCell<Option<MqttHandler>>,
}

impl PubSub for HostPubSub {
    fn set_handler(&self, handler: MqttHandler) {
        *self.handler.borrow_mut() = Some(handler);
    }
    fn subscribe(&self, filter: &str) {
        // SAFETY: (ptr, len) of a live string.
        unsafe { host::mqtt_subscribe(filter.as_ptr(), filter.len() as i32) };
    }
    fn publish(&self, topic: &str, payload: &str) {
        // SAFETY: (ptr, len) of live strings.
        unsafe {
            host::mqtt_publish(
                topic.as_ptr(),
                topic.len() as i32,
                payload.as_ptr(),
                payload.len() as i32,
            )
        };
    }
}

struct Guest {
    app: App,
    strand: Rc<Strand>,
    vehicle: Rc<HostVehicle>,
    pubsub: Rc<HostPubSub>,
    runtime: Runtime,
    started: bool,
}

thread_local! {
    static GUEST: RefCell<Option<Guest>> = const { RefCell::new(None) };
}

fn text(p: *const u8, n: i32) -> String {
    if p.is_null() || n <= 0 {
        return String::new();
    }
    // SAFETY: the host wrote n bytes at p (memory from `sv_alloc`).
    String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(p, n as usize) }).into_owned()
}

/// `<workflow>.<case>` with every non-word character as `_` (a gtest test name: no spaces).
fn test_id(workflow: &str, name: &str) -> String {
    let wf = if workflow.is_empty() { "app" } else { workflow };
    let case: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{wf}.{case}")
}

fn level_of(s: &str) -> u8 {
    match s {
        "off" => 0,
        "trigger" => 1,
        _ => 2,
    }
}

// ---- the exports, called by the code `wasm_app!` defines --------------------------------------------------------

pub fn alloc(n: i32) -> *mut u8 {
    let mut b = Vec::<u8>::with_capacity(n.max(1) as usize);
    let p = b.as_mut_ptr();
    std::mem::forget(b);
    p
}

/// Frees what [`alloc`] gave.
///
/// # Safety
/// `p` must come from `alloc(n)` with the same `n`, and not be freed twice.
pub unsafe fn free(p: *mut u8, n: i32) {
    if !p.is_null() {
        // SAFETY: `p` came from `alloc(n)` (capacity n.max(1)), nothing was pushed (len 0).
        drop(unsafe { Vec::from_raw_parts(p, 0, n.max(1) as usize) });
    }
}

/// Config `{app, traceLevel}`: binds the workflows and subscribes their signals; the runtime starts on `start`.
pub fn init(app: App, config: *const u8, n: i32) -> i32 {
    let cfg = v::parse_json(&text(config, n)).unwrap_or(Value::Null);
    let level = match cfg.get("traceLevel") {
        Some(Value::Str(s)) => level_of(s),
        _ => level_of(app.trace_level),
    };
    let strand = Rc::new(Strand::new_virtual());
    strand.run_until(now());
    let vehicle = Rc::new(HostVehicle {
        strand: strand.clone(),
        subs: RefCell::default(),
        gets: RefCell::default(),
        sets: RefCell::default(),
    });
    let pubsub = Rc::new(HostPubSub {
        handler: RefCell::new(None),
    });
    let runtime = Runtime::new(
        strand.clone(),
        vehicle.clone(),
        pubsub.clone(),
        Rc::new(HostSink { level }),
    );
    for (_, bind) in &app.workflows {
        bind(&runtime);
    }
    for (path, ty) in runtime.signals() {
        vehicle.prefetch(&path, &ty);
    }
    GUEST.with(|g| {
        *g.borrow_mut() = Some(Guest {
            app,
            strand,
            vehicle,
            pubsub,
            runtime,
            started: false,
        })
    });
    0
}

pub fn on_event(event: *const u8, n: i32) {
    let Ok(e) = v::parse_json(&text(event, n)) else {
        return;
    };
    GUEST.with(|g| {
        let mut g = g.borrow_mut();
        let Some(g) = g.as_mut() else { return };
        // What is due runs first, so the event lands at the host's instant.
        g.strand.run_until(g.strand.now_ms().max(now()));
        match e.get("kind") {
            Some(Value::Str(k)) if k == "start" => {
                if !std::mem::replace(&mut g.started, true) {
                    (g.app.on_app_start)();
                    g.runtime.start();
                }
            }
            Some(Value::Str(k)) if k == "mqtt" => {
                let handler = g.pubsub.handler.borrow().clone();
                if let (Some(h), Some(Value::Str(topic)), Some(Value::Str(payload))) =
                    (handler, e.get("topic"), e.get("payload"))
                {
                    let (topic, payload) = (topic.clone(), payload.clone());
                    g.strand.post(move || h(&topic, &payload, None));
                }
            }
            Some(Value::Str(k)) if k == "stop" => g.runtime.stop_all(),
            _ => g.vehicle.on_event(&e, g.started),
        }
    });
}

/// Runs everything due up to `now`; the next due time, -1 when nothing is scheduled.
pub fn step(now: i64) -> i64 {
    GUEST.with(|g| match g.borrow().as_ref() {
        Some(g) => {
            g.strand.run_until(g.strand.now_ms().max(now));
            g.strand.next_due_ms().unwrap_or(-1)
        }
        None => -1,
    })
}

pub fn stop() {
    GUEST.with(|g| {
        if let Some(g) = g.borrow().as_ref() {
            g.runtime.trace_lifecycle("app.stopping");
            (g.app.on_app_stop)();
            g.runtime.stop_all();
        }
    });
}

/// Test cases `[{name, workflow, scenario}]` on the mock vehicle and a virtual clock inside the guest: each case
/// runs its workflow only, like the native generated tests; one log line per case, the number of failed cases.
pub fn run_tests(app: App, cases: *const u8, n: i32) -> i32 {
    let Ok(Value::Array(list)) = v::parse_json(&text(cases, n)) else {
        return 1;
    };
    let mut failed = 0;
    for c in list {
        let name = match c.get("name") {
            Some(Value::Str(s)) => s.clone(),
            _ => "case".into(),
        };
        let workflow = match c.get("workflow") {
            Some(Value::Str(s)) => s.clone(),
            _ => String::new(),
        };
        let binds: Vec<Bind> = app
            .workflows
            .iter()
            .filter(|(id, _)| workflow.is_empty() || *id == workflow)
            .map(|(_, b)| *b)
            .collect();
        // gtest-style lines (`[ RUN      ]`, `[       OK ]`, `[  FAILED  ]`), like every backend's generated tests.
        let id = test_id(&workflow, &name);
        let mismatches = if binds.is_empty() {
            vec![format!("no workflow {workflow} in this app")]
        } else {
            let scenario = c.get("scenario").cloned().unwrap_or(Value::Null);
            let result = testing::run_scenario(
                &|rt: &Runtime| binds.iter().for_each(|b| b(rt)),
                &scenario,
                "test",
                &[],
            );
            testing::check_expectations(&result, scenario.get("expect"))
        };
        let mut line = format!("[ RUN      ] {id}");
        for m in &mismatches {
            line.push_str(&format!("\n{m}"));
        }
        let verdict = if mismatches.is_empty() {
            "[       OK ]"
        } else {
            "[  FAILED  ]"
        };
        line.push_str(&format!("\n{verdict} {id} (0 ms)"));
        log(if mismatches.is_empty() { 1 } else { 3 }, &line);
        failed += i32::from(!mismatches.is_empty());
    }
    failed
}

/// Defines the `sv_*` exports of a WebAssembly app (sv-wasm-abi/1) for the app `$app` (an expression of type
/// [`App`](crate::wasm::App), evaluated at each call that needs it).
#[macro_export]
macro_rules! wasm_app {
    ($app:expr) => {
        #[no_mangle]
        pub extern "C" fn sv_alloc(n: i32) -> *mut u8 {
            $crate::wasm::alloc(n)
        }
        #[no_mangle]
        pub extern "C" fn sv_free(p: *mut u8, n: i32) {
            // SAFETY: the host frees only what sv_alloc gave it, with the same length (sv-wasm-abi §4).
            unsafe { $crate::wasm::free(p, n) }
        }
        #[no_mangle]
        pub extern "C" fn sv_init(p: *const u8, n: i32) -> i32 {
            $crate::wasm::init($app, p, n)
        }
        #[no_mangle]
        pub extern "C" fn sv_on_event(p: *const u8, n: i32) {
            $crate::wasm::on_event(p, n)
        }
        #[no_mangle]
        pub extern "C" fn sv_step(now: i64) -> i64 {
            $crate::wasm::step(now)
        }
        #[no_mangle]
        pub extern "C" fn sv_stop() {
            $crate::wasm::stop()
        }
        #[no_mangle]
        pub extern "C" fn sv_run_tests(p: *const u8, n: i32) -> i32 {
            $crate::wasm::run_tests($app, p, n)
        }
    };
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn bind(rt: &Runtime) {
        let w = rt.workflow("wf", "Echo");
        let speed = w.signal("s0", "Vehicle.Speed", "float");
        let hazard = w.signal("s1", "Vehicle.Body.Lights.Hazard.IsSignaling", "boolean");
        let _ = (speed, hazard);
    }

    fn app() -> App {
        App {
            name: "Echo",
            trace_level: "node",
            workflows: vec![("wf", bind)],
            on_app_start: || {},
            on_app_stop: || {},
        }
    }

    #[test]
    fn init_subscribes_the_signals_and_waits_for_start() {
        fake::CALLS.with(|c| c.borrow_mut().clear());
        let cfg = br#"{"app":"Echo","traceLevel":"node"}"#;
        assert_eq!(init(app(), cfg.as_ptr(), cfg.len() as i32), 0);
        let calls = fake::CALLS.with(|c| c.borrow().clone());
        assert_eq!(
            calls,
            vec![
                "subscribe Vehicle.Body.Lights.Hazard.IsSignaling boolean",
                "subscribe Vehicle.Speed float"
            ]
        );
        assert_eq!(step(100), -1);
        let start = br#"{"kind":"start"}"#;
        on_event(start.as_ptr(), start.len() as i32);
        stop();
        let calls = fake::CALLS.with(|c| c.borrow().clone());
        assert!(
            calls.iter().any(|c| c == r#"trace {"ev":"app.stopping"}"#),
            "{calls:?}"
        );
        let empty = b"[]";
        assert_eq!(run_tests(app(), empty.as_ptr(), 2), 0);
        let unknown = br#"[{"name":"x","workflow":"nope","scenario":{}}]"#;
        assert_eq!(run_tests(app(), unknown.as_ptr(), unknown.len() as i32), 1);
    }
}
