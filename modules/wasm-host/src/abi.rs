//! The host side of `sv-wasm-abi/1` (contracts `abi/sv-wasm-abi.v1.md`): engine and limits, the `sv.*` imports, the
//! `sv_*` exports, and [`pump`], which runs what the guest asked for on a [`Vehicle`] and delivers the answers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use wasmtime::{
    Caller, Config, Engine, Instance, Linker, Memory, Module, Store, StoreLimits,
    StoreLimitsBuilder, Trap, TypedFunc,
};
use wasmtime_wasi::p1::WasiP1Ctx;
use wasmtime_wasi::WasiCtxBuilder;

use crate::allow::Allowlist;
use crate::vehicle::{Request, Vehicle};

pub const ABI: &str = "sv-wasm-abi/1";
/// One epoch tick; a call's deadline is counted in ticks.
const TICK: Duration = Duration::from_millis(10);

/// Import error codes (ABI §5).
pub const ERR_NONE: i32 = -1;
pub const ERR_FORBIDDEN: i32 = -2;
pub const ERR_ARGUMENT: i32 = -3;

#[derive(Clone, Debug)]
pub struct Limits {
    /// Linear memory of the guest (default 64 MiB, `SV_WASM_MAX_MEMORY_MB`).
    pub max_memory_mb: usize,
    /// Time of one export call (default 200 ms).
    pub deadline_ms: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_memory_mb: 64,
            deadline_ms: 200,
        }
    }
}

/// A line the guest wrote: a log line (stdout, stderr for errors) or an `SVTRACE` line.
#[derive(Clone, Debug, PartialEq)]
pub enum Line {
    Out(String),
    Err(String),
}

/// Why the app had to stop: over a limit (`wasm_limit`) or a trap (`wasm_trap`); traced and the exit code is non-zero.
#[derive(Debug)]
pub struct Fault {
    pub reason: &'static str,
    pub message: String,
}

impl std::fmt::Display for Fault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason, self.message)
    }
}

impl std::error::Error for Fault {}

pub struct State {
    wasi: WasiP1Ctx,
    limits: StoreLimits,
    allow: Allowlist,
    clock: Box<dyn Fn() -> i64 + Send>,
    next_id: i32,
    requests: Vec<Request>,
    /// Events the host answers by itself (a forbidden write), delivered like the vehicle's.
    events: Vec<String>,
    /// Latest value by path (`vdb_current`), from `signal` and `get_result` events.
    cache: HashMap<String, String>,
    gets: HashMap<i32, String>,
    lines: Vec<Line>,
}

/// The engine every app of this host runs on — `.cwasm` files are only valid for the same configuration (ABI §5).
pub fn engine() -> Result<(Engine, Ticker)> {
    let mut c = Config::new();
    c.epoch_interruption(true);
    // C++ guests use the exception-handling proposal (`-fwasm-exceptions`, M20-T01 spike).
    c.wasm_exceptions(true);
    let engine = Engine::new(&c)?;
    Ok((engine.clone(), Ticker::start(engine)))
}

/// Advances the engine's epoch every [`TICK`] while it lives.
pub struct Ticker {
    stop: Arc<AtomicBool>,
}

impl Ticker {
    fn start(engine: Engine) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let s = stop.clone();
        std::thread::spawn(move || {
            while !s.load(Ordering::Relaxed) {
                std::thread::sleep(TICK);
                engine.increment_epoch();
            }
        });
        Ticker { stop }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// A module from `.wasm` (compiled now) or `.cwasm` (precompiled by this host build).
pub fn load(engine: &Engine, bytes: &[u8]) -> Result<Module> {
    if Engine::detect_precompiled(bytes).is_some() {
        // SAFETY: a `.cwasm` is only accepted from this host's own `--precompile` (ABI §5); Wasmtime checks that the
        // engine configuration and version match and refuses it otherwise.
        unsafe { Module::deserialize(engine, bytes) }.map_err(|e| {
            anyhow::Error::from(e)
                .context("precompiled module from another host build or configuration")
        })
    } else {
        Ok(Module::new(engine, bytes)?)
    }
}

pub fn precompile(engine: &Engine, wasm: &[u8]) -> Result<Vec<u8>> {
    Ok(engine.precompile_module(wasm)?)
}

pub fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn memory(caller: &mut Caller<'_, State>) -> Option<Memory> {
    caller.get_export("memory").and_then(|e| e.into_memory())
}

/// A guest string `(ptr, len)`; `None` when out of bounds or not UTF-8.
fn string(caller: &mut Caller<'_, State>, ptr: i32, len: i32) -> Option<String> {
    let mem = memory(caller)?;
    let (p, n) = (usize::try_from(ptr).ok()?, usize::try_from(len).ok()?);
    let bytes = mem.data(&caller).get(p..p.checked_add(n)?)?;
    String::from_utf8(bytes.to_vec()).ok()
}

fn next_id(s: &mut State) -> i32 {
    s.next_id += 1;
    s.next_id
}

fn define(linker: &mut Linker<State>) -> Result<()> {
    wasmtime_wasi::p1::add_to_linker_sync(linker, |s: &mut State| &mut s.wasi)?;
    linker.func_wrap("sv", "now_ms", |c: Caller<'_, State>| (c.data().clock)())?;
    linker.func_wrap(
        "sv",
        "log",
        |mut c: Caller<'_, State>, level: i32, p: i32, n: i32| {
            if let Some(text) = string(&mut c, p, n) {
                c.data_mut().lines.push(if level >= 3 {
                    Line::Err(text)
                } else {
                    Line::Out(text)
                });
            }
        },
    )?;
    linker.func_wrap("sv", "trace", |mut c: Caller<'_, State>, p: i32, n: i32| {
        let Some(json) = string(&mut c, p, n) else {
            return;
        };
        let app = c.data().allow.app.clone();
        if let Some(line) = trace_line(&app, epoch_ms(), &json) {
            c.data_mut().lines.push(Line::Out(line));
        }
    })?;
    linker.func_wrap(
        "sv",
        "vdb_subscribe",
        |mut c: Caller<'_, State>, pp: i32, pn: i32, tp: i32, tn: i32| -> i32 {
            let (Some(path), Some(ty)) = (string(&mut c, pp, pn), string(&mut c, tp, tn)) else {
                return ERR_ARGUMENT;
            };
            let s = c.data_mut();
            if !s.allow.reads(&path) {
                return ERR_FORBIDDEN;
            }
            let sub = next_id(s);
            s.requests.push(Request::Subscribe { sub, path, ty });
            sub
        },
    )?;
    linker.func_wrap(
        "sv",
        "vdb_current",
        |mut c: Caller<'_, State>,
         pp: i32,
         pn: i32,
         _tp: i32,
         _tn: i32,
         out: i32,
         cap: i32|
         -> i32 {
            let Some(path) = string(&mut c, pp, pn) else {
                return ERR_ARGUMENT;
            };
            if !c.data().allow.reads(&path) {
                return ERR_FORBIDDEN;
            }
            let Some(value) = c.data().cache.get(&path).cloned() else {
                return ERR_NONE;
            };
            let len = value.len() as i32;
            if len > cap {
                return len;
            }
            let Some(mem) = memory(&mut c) else {
                return ERR_ARGUMENT;
            };
            match mem.write(&mut c, out as usize, value.as_bytes()) {
                Ok(()) => len,
                Err(_) => ERR_ARGUMENT,
            }
        },
    )?;
    linker.func_wrap(
        "sv",
        "vdb_get",
        |mut c: Caller<'_, State>, pp: i32, pn: i32, tp: i32, tn: i32| -> i32 {
            let (Some(path), Some(ty)) = (string(&mut c, pp, pn), string(&mut c, tp, tn)) else {
                return ERR_ARGUMENT;
            };
            let s = c.data_mut();
            if !s.allow.reads(&path) {
                return ERR_FORBIDDEN;
            }
            let req = next_id(s);
            s.gets.insert(req, path.clone());
            s.requests.push(Request::Get { req, path, ty });
            req
        },
    )?;
    linker.func_wrap(
        "sv",
        "vdb_set",
        |mut c: Caller<'_, State>, pp: i32, pn: i32, tp: i32, tn: i32, vp: i32, vn: i32| -> i32 {
            let (Some(path), Some(ty), Some(value)) = (
                string(&mut c, pp, pn),
                string(&mut c, tp, tn),
                string(&mut c, vp, vn),
            ) else {
                return ERR_ARGUMENT;
            };
            if serde_json::from_str::<Value>(&value).is_err() {
                return ERR_ARGUMENT;
            }
            let s = c.data_mut();
            let req = next_id(s);
            if s.allow.writes(&path) {
                s.requests.push(Request::Set {
                    req,
                    path,
                    ty,
                    value,
                });
            } else {
                s.events.push(format!(
                    r#"{{"kind":"set_result","req":{req},"error":"forbidden"}}"#
                ));
            }
            req
        },
    )?;
    linker.func_wrap(
        "sv",
        "mqtt_subscribe",
        |mut c: Caller<'_, State>, p: i32, n: i32| -> i32 {
            let Some(filter) = string(&mut c, p, n) else {
                return ERR_ARGUMENT;
            };
            let s = c.data_mut();
            if !s.allow.topic(filter.trim_end_matches(['#', '+'])) {
                return ERR_FORBIDDEN;
            }
            let sub = next_id(s);
            s.requests.push(Request::MqttSubscribe { sub, filter });
            sub
        },
    )?;
    linker.func_wrap(
        "sv",
        "mqtt_publish",
        |mut c: Caller<'_, State>, tp: i32, tn: i32, pp: i32, pn: i32| -> i32 {
            let (Some(topic), Some(payload)) = (string(&mut c, tp, tn), string(&mut c, pp, pn))
            else {
                return ERR_ARGUMENT;
            };
            let s = c.data_mut();
            if !s.allow.topic(&topic) {
                return ERR_FORBIDDEN;
            }
            s.requests.push(Request::MqttPublish { topic, payload });
            0
        },
    )?;
    Ok(())
}

/// `SVTRACE {"v":1,"ts":…,"app":…, <the guest's keys>}` — the native runtimes' line (contracts trace-event `runtimeLine`).
pub fn trace_line(app: &str, ts: i64, guest_json: &str) -> Option<String> {
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(guest_json) else {
        return None;
    };
    let mut line = serde_json::Map::new();
    line.insert("v".into(), Value::from(1));
    line.insert("ts".into(), Value::from(ts));
    line.insert("app".into(), Value::from(app));
    for (k, v) in fields {
        if !matches!(k.as_str(), "v" | "ts" | "app") {
            line.insert(k, v);
        }
    }
    Some(format!("SVTRACE {}", Value::Object(line)))
}

/// One running guest.
pub struct Host {
    store: Store<State>,
    deadline_ticks: u64,
    alloc: TypedFunc<i32, i32>,
    free: TypedFunc<(i32, i32), ()>,
    init: TypedFunc<(i32, i32), i32>,
    on_event: TypedFunc<(i32, i32), ()>,
    step: TypedFunc<i64, i64>,
    stop: TypedFunc<(), ()>,
    run_tests: Option<TypedFunc<(i32, i32), i32>>,
    memory: Memory,
    inst: Instance,
}

impl Host {
    /// Instantiates `module` and runs its `_initialize` (a reactor's constructors).
    pub fn new(
        engine: &Engine,
        module: &Module,
        allow: Allowlist,
        limits: &Limits,
        clock: Box<dyn Fn() -> i64 + Send>,
    ) -> Result<Host> {
        let wasi = WasiCtxBuilder::new()
            .inherit_stdout()
            .inherit_stderr()
            .build_p1();
        let state = State {
            wasi,
            limits: StoreLimitsBuilder::new()
                .memory_size(limits.max_memory_mb << 20)
                .instances(1)
                .build(),
            allow,
            clock,
            next_id: 0,
            requests: Vec::new(),
            events: Vec::new(),
            cache: HashMap::new(),
            gets: HashMap::new(),
            lines: Vec::new(),
        };
        let mut store = Store::new(engine, state);
        store.limiter(|s| &mut s.limits);
        let deadline_ticks = (limits.deadline_ms / TICK.as_millis() as u64).max(1);
        store.set_epoch_deadline(deadline_ticks);
        let mut linker = Linker::new(engine);
        define(&mut linker)?;
        let inst: Instance = linker.instantiate(&mut store, module).map_err(fault)?;
        if let Ok(f) = inst.get_typed_func::<(), ()>(&mut store, "_initialize") {
            f.call(&mut store, ()).map_err(fault)?;
        }
        let memory = inst
            .get_memory(&mut store, "memory")
            .ok_or_else(|| anyhow!("the module exports no memory"))?;
        let mut func = |name: &str| {
            inst.get_func(&mut store, name)
                .ok_or_else(|| anyhow!("the module does not export {name} ({ABI})"))
        };
        let (alloc, free, init, on_event, step, stop) = (
            func("sv_alloc")?,
            func("sv_free")?,
            func("sv_init")?,
            func("sv_on_event")?,
            func("sv_step")?,
            func("sv_stop")?,
        );
        let run_tests = inst
            .get_typed_func::<(i32, i32), i32>(&mut store, "sv_run_tests")
            .ok();
        Ok(Host {
            alloc: alloc.typed(&store)?,
            free: free.typed(&store)?,
            init: init.typed(&store)?,
            on_event: on_event.typed(&store)?,
            step: step.typed(&store)?,
            stop: stop.typed(&store)?,
            run_tests,
            memory,
            inst,
            deadline_ticks,
            store,
        })
    }

    fn arm(&mut self) {
        self.store.set_epoch_deadline(self.deadline_ticks);
    }

    /// Writes `text` into guest memory (`sv_alloc`), runs `f` on it, frees it.
    fn with_string<R>(
        &mut self,
        text: &str,
        f: impl FnOnce(&mut Self, i32, i32) -> Result<R>,
    ) -> Result<R> {
        let len = i32::try_from(text.len()).context("string too long for the guest")?;
        self.arm();
        let ptr = self.alloc.call(&mut self.store, len).map_err(fault)?;
        if ptr == 0 && len > 0 {
            return Err(Fault {
                reason: "wasm_limit",
                message: "the guest could not allocate memory".into(),
            }
            .into());
        }
        self.memory
            .write(&mut self.store, ptr as usize, text.as_bytes())?;
        let out = f(self, ptr, len);
        self.arm();
        self.free.call(&mut self.store, (ptr, len)).map_err(fault)?;
        out
    }

    /// `sv_init(config)`: `0` when the app started.
    pub fn init(&mut self, config: &str) -> Result<i32> {
        self.with_string(config, |h, p, n| {
            h.arm();
            h.init.call(&mut h.store, (p, n)).map_err(fault)
        })
    }

    /// Delivers one event (ABI §4.1) and keeps the cache of `vdb_current` up to date.
    pub fn deliver(&mut self, event: &str) -> Result<()> {
        if let Ok(v) = serde_json::from_str::<Value>(event) {
            let s = self.store.data_mut();
            let path = match v.get("kind").and_then(Value::as_str) {
                Some("signal") => v.get("path").and_then(Value::as_str).map(str::to_string),
                Some("get_result") => v
                    .get("req")
                    .and_then(Value::as_i64)
                    .and_then(|r| s.gets.remove(&(r as i32))),
                _ => None,
            };
            if let (Some(path), Some(value)) = (path, v.get("value")) {
                if !value.is_null() {
                    s.cache.insert(path, value.to_string());
                }
            }
        }
        self.with_string(event, |h, p, n| {
            h.arm();
            h.on_event.call(&mut h.store, (p, n)).map_err(fault)
        })
    }

    /// `sv_step(now)`: the next due time, `-1` when nothing is scheduled.
    pub fn step(&mut self, now: i64) -> Result<i64> {
        self.arm();
        self.step.call(&mut self.store, now).map_err(fault)
    }

    pub fn stop(&mut self) -> Result<()> {
        self.arm();
        self.stop.call(&mut self.store, ()).map_err(fault)
    }

    /// `sv_run_tests(cases)`: the number of failed cases.
    pub fn run_tests(&mut self, cases: &str) -> Result<i32> {
        let f = self
            .run_tests
            .clone()
            .ok_or_else(|| anyhow!("the module does not export sv_run_tests"))?;
        self.with_string(cases, |h, p, n| {
            // Test cases run on a virtual clock inside the guest: no wall-clock deadline per call.
            h.store.set_epoch_deadline(u64::MAX / 2);
            f.call(&mut h.store, (p, n)).map_err(fault)
        })
    }

    /// Calls an extra export `() -> i32` of the guest (diagnostics and tests).
    pub fn call_i32(&mut self, name: &str) -> Result<i32> {
        let f = self.inst.get_typed_func::<(), i32>(&mut self.store, name)?;
        self.arm();
        f.call(&mut self.store, ()).map_err(fault)
    }

    pub fn now_ms(&self) -> i64 {
        (self.store.data().clock)()
    }

    pub fn take_requests(&mut self) -> Vec<Request> {
        std::mem::take(&mut self.store.data_mut().requests)
    }

    pub fn take_events(&mut self) -> Vec<String> {
        std::mem::take(&mut self.store.data_mut().events)
    }

    pub fn take_lines(&mut self) -> Vec<Line> {
        std::mem::take(&mut self.store.data_mut().lines)
    }

    pub fn app(&self) -> &str {
        &self.store.data().allow.app
    }
}

/// A trap or a limit becomes a [`Fault`]; anything else stays an error of the host.
fn fault(e: wasmtime::Error) -> anyhow::Error {
    let reason = match e.downcast_ref::<Trap>() {
        Some(Trap::Interrupt) => "wasm_limit",
        Some(_) => "wasm_trap",
        None => return e.into(),
    };
    let message = if reason == "wasm_limit" {
        "the app ran past its time limit".to_string()
    } else {
        format!("{e:#}")
    };
    Fault { reason, message }.into()
}

/// The `SVTRACE` error line of a fault (the host stops the app after it).
pub fn fault_line(app: &str, f: &Fault) -> String {
    let data = serde_json::json!({"reason": f.reason, "message": f.message});
    trace_line(
        app,
        epoch_ms(),
        &serde_json::json!({"ev": "error", "data": data}).to_string(),
    )
    .unwrap_or_default()
}

/// Runs the guest's requests on `vehicle` and delivers the answers (each followed by `sv_step`) until nothing is left.
/// Returns the guest's next due time.
pub fn pump(host: &mut Host, vehicle: &mut dyn Vehicle) -> Result<i64> {
    let mut due = host.step(host.now_ms())?;
    loop {
        let mut events = host.take_events();
        for r in host.take_requests() {
            events.extend(vehicle.execute(r));
        }
        if events.is_empty() {
            return Ok(due);
        }
        for e in events {
            host.deliver(&e)?;
            due = host.step(host.now_ms())?;
        }
    }
}

/// A monotonic clock from now (`now_ms`, ABI §3).
pub fn monotonic() -> Box<dyn Fn() -> i64 + Send> {
    let start = Instant::now();
    Box::new(move || start.elapsed().as_millis() as i64)
}
