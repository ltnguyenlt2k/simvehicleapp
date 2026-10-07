//! Mock vehicle, mock MQTT and the scenario runner (C++ `Testing.cpp`; ADR-0042 conformance P1).
//!
//! `run_scenario(bind, scenario)` runs workflows on the virtual clock exactly like the reference simulator
//! replays a scenario: initial values are baselines, inputs are posted at their time before the app start,
//! and the result is the trace, the writes, the signals, the publishes and the logs as JSON values.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::runtime::{MqttHandler, PubSub, Runtime, TraceRecord, TraceSink, VehicleAccess};
use crate::strand::Strand;
use crate::values::{self as v, Value};

#[derive(Clone, Default)]
pub struct Bounds {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub allowed: Option<Vec<Value>>,
}

type Subscriber = Rc<dyn Fn(Value)>;

#[derive(Default)]
struct VehicleState {
    raw: HashMap<String, Value>,
    values: HashMap<String, Value>,
    types: HashMap<String, String>,
    subs: HashMap<String, Vec<Subscriber>>,
    bounds: HashMap<String, Bounds>,
    read_ms: i64,
    write_ms: i64,
    writes: Vec<Value>,
    signals: Vec<Value>,
}

pub struct MockVehicle {
    strand: Rc<Strand>,
    me: std::rc::Weak<MockVehicle>,
    s: RefCell<VehicleState>,
}

fn timed(t: i64, key: &str, k: Value, val: &str, x: Value) -> Value {
    Value::obj(vec![("t", Value::Int(t as i128)), (key, k), (val, x)])
}

fn text(x: &Value) -> String {
    match x {
        Value::Str(s) => s.clone(),
        other => v::fmt(other, ""),
    }
}

impl MockVehicle {
    pub fn new(strand: Rc<Strand>) -> Rc<Self> {
        Rc::new_cyclic(|me| MockVehicle {
            strand,
            me: me.clone(),
            s: RefCell::new(VehicleState::default()),
        })
    }
    pub fn set_initial(&self, path: &str, value: Value) {
        self.s.borrow_mut().raw.insert(path.into(), value);
    }
    pub fn set_latency(&self, read_ms: i64, write_ms: i64) {
        let mut s = self.s.borrow_mut();
        s.read_ms = read_ms;
        s.write_ms = write_ms;
    }
    pub fn set_bounds(&self, path: &str, b: Bounds) {
        self.s.borrow_mut().bounds.insert(path.into(), b);
    }
    pub fn inject(&self, path: &str, raw: &Value) {
        let (x, subs) = {
            let mut s = self.s.borrow_mut();
            let Some(ty) = s.types.get(path).cloned() else {
                return;
            }; // a signal the app does not use
            let x = v::from_json(raw, &ty);
            s.values.insert(path.into(), x.clone());
            let t = self.strand.now_ms();
            s.signals.push(timed(
                t,
                "path",
                Value::str(path),
                "value",
                v::to_json(&x, Some(&ty)),
            ));
            (x, s.subs.get(path).cloned().unwrap_or_default())
        };
        for cb in subs {
            cb(x.clone());
        }
    }
    pub fn writes(&self) -> Vec<Value> {
        self.s.borrow().writes.clone()
    }
    pub fn signals(&self) -> Vec<Value> {
        self.s.borrow().signals.clone()
    }
}

impl VehicleAccess for MockVehicle {
    fn current(&self, path: &str, ty: &str) -> Option<Value> {
        let mut s = self.s.borrow_mut();
        s.types.insert(path.into(), ty.into());
        let raw = s.raw.get(path).cloned()?;
        let x = v::from_json(&raw, ty);
        s.values.insert(path.into(), x.clone());
        Some(x)
    }
    fn subscribe(&self, path: &str, ty: &str, on_value: Box<dyn Fn(Value)>) {
        let mut s = self.s.borrow_mut();
        s.types.insert(path.into(), ty.into());
        s.subs
            .entry(path.into())
            .or_default()
            .push(Rc::from(on_value));
    }
    fn get(&self, path: &str, _ty: &str, done: Box<dyn FnOnce(Option<Value>, String)>) {
        // The value when the answer arrives (after the read latency), like the C++/Python mocks.
        let at = self.strand.now_ms() + self.s.borrow().read_ms;
        let (me, path) = (self.me.clone(), path.to_string());
        self.strand.post_at(at, move || {
            let x = me
                .upgrade()
                .and_then(|m| m.s.borrow().values.get(&path).cloned());
            done(x, String::new())
        });
    }
    fn check_write(&self, path: &str, ty: &str, value: &Value) -> String {
        let s = self.s.borrow();
        let Some(b) = s.bounds.get(path) else {
            return String::new();
        };
        let numeric = v::is_number(value);
        let n = v::num(value);
        let mut bad =
            (b.min.is_some_and(|m| numeric && n < m)) || (b.max.is_some_and(|m| numeric && n > m));
        if !bad {
            if let Some(allowed) = &b.allowed {
                bad = !allowed.iter().any(|x| text(x) == text(value));
            }
        }
        if !bad {
            return String::new();
        }
        format!(
            "{} is outside the allowed values of {path}",
            text(&v::to_json(value, Some(ty)))
        )
    }
    fn set(&self, path: &str, ty: &str, value: Value, done: Option<Box<dyn FnOnce(String)>>) {
        // An actuator write sets its target; the current value changes only when the vehicle reports it.
        let write_ms = {
            let mut s = self.s.borrow_mut();
            let t = self.strand.now_ms();
            s.writes.push(timed(
                t,
                "path",
                Value::str(path),
                "value",
                v::to_json(&value, Some(ty)),
            ));
            s.write_ms
        };
        if let Some(done) = done {
            self.strand
                .post_at(self.strand.now_ms() + write_ms, move || done(String::new()));
        }
    }
}

pub struct MockPubSub {
    strand: Rc<Strand>,
    handler: RefCell<Option<MqttHandler>>,
    publishes: RefCell<Vec<Value>>,
}

impl MockPubSub {
    pub fn new(strand: Rc<Strand>) -> Rc<Self> {
        Rc::new(MockPubSub {
            strand,
            handler: RefCell::new(None),
            publishes: RefCell::new(Vec::new()),
        })
    }
    pub fn inject(&self, topic: &str, payload: &str) {
        let h = self.handler.borrow().clone();
        if let Some(h) = h {
            h(topic, payload, None);
        }
    }
    /// Delivery by subscription filter (what the Velocitas SDK does: the payload only).
    pub fn deliver(&self, filter: &str, payload: &str) {
        let h = self.handler.borrow().clone();
        if let Some(h) = h {
            h(filter, payload, Some(filter));
        }
    }
    pub fn publishes(&self) -> Vec<Value> {
        self.publishes.borrow().clone()
    }
}

impl PubSub for MockPubSub {
    fn set_handler(&self, handler: MqttHandler) {
        *self.handler.borrow_mut() = Some(handler);
    }
    fn subscribe(&self, _filter: &str) {}
    fn publish(&self, topic: &str, payload: &str) {
        let t = self.strand.now_ms();
        self.publishes.borrow_mut().push(timed(
            t,
            "topic",
            Value::str(topic),
            "payload",
            Value::str(payload),
        ));
        self.inject(topic, payload);
    }
}

#[derive(Default)]
pub struct RecordingSink {
    pub records: RefCell<Vec<TraceRecord>>,
    pub logs: RefCell<Vec<Value>>,
}

impl TraceSink for RecordingSink {
    fn trace(&self, record: &TraceRecord) {
        self.records.borrow_mut().push(record.clone());
    }
    fn log(&self, ts: i64, level: &str, message: &str) {
        self.logs.borrow_mut().push(timed(
            ts,
            "level",
            Value::str(level),
            "message",
            Value::str(message),
        ));
    }
}

pub struct ScenarioResult {
    pub trace: Vec<Value>,
    pub writes: Vec<Value>,
    pub signals: Vec<Value>,
    pub publishes: Vec<Value>,
    pub logs: Vec<Value>,
}

/// Runs `scenario` (Scenario v1 as a JSON value) on the mock vehicle and virtual clock.
pub fn run_scenario(
    bind: &dyn Fn(&Runtime),
    scenario: &Value,
    run_id: &str,
    bounds: &[(&str, Bounds)],
) -> ScenarioResult {
    let strand = Rc::new(Strand::new_virtual());
    let vehicle = MockVehicle::new(strand.clone());
    let pubsub = MockPubSub::new(strand.clone());
    let sink = Rc::new(RecordingSink::default());
    let rt = Runtime::new(
        strand.clone(),
        vehicle.clone(),
        pubsub.clone(),
        sink.clone(),
    );
    bind(&rt);

    if let Some(Value::Object(initial)) = scenario.get("initial") {
        for (path, value) in initial {
            vehicle.set_initial(path, value.clone());
        }
    }
    if let Some(l) = scenario.get("latency") {
        let n = |k: &str| l.get(k).map(v::num).unwrap_or(0.0) as i64;
        vehicle.set_latency(n("read"), n("write"));
    }
    for (path, b) in bounds {
        vehicle.set_bounds(path, b.clone());
    }
    // Inputs first (lowest sequence at each instant), then the app start — simulator order.
    if let Some(Value::Array(inputs)) = scenario.get("inputs") {
        for input in inputs {
            let t = v::num(input.get("t").unwrap_or(&Value::Int(0))) as i64;
            let value = input.get("value").cloned().unwrap_or(Value::Null);
            if let Some(Value::Str(topic)) = input.get("topic") {
                let payload = match &value {
                    Value::Str(s) => s.clone(),
                    other => v::js_json(other),
                };
                let (p, topic) = (pubsub.clone(), topic.clone());
                strand.post_at(t, move || p.inject(&topic, &payload));
            } else if let Some(Value::Str(path)) = input.get("path") {
                let (veh, path) = (vehicle.clone(), path.clone());
                strand.post_at(t, move || veh.inject(&path, &value));
            }
        }
    }
    rt.start();
    strand.run_until(v::num(scenario.get("until").unwrap_or(&Value::Int(0))) as i64);

    let trace = sink
        .records
        .borrow()
        .iter()
        .map(|r| {
            let mut e = vec![
                ("runId", Value::str(run_id)),
                ("seq", Value::Int(r.seq as i128)),
                ("ts", Value::Int(r.ts as i128)),
                ("ev", Value::str(&r.ev)),
            ];
            if !r.wf.is_empty() {
                e.push(("wf", Value::str(&r.wf)));
            }
            if let Some(run) = r.run {
                e.push(("run", Value::Int(run as i128)));
            }
            if !r.node.is_empty() {
                e.push(("node", Value::str(&r.node)));
            }
            if !r.block_id.is_empty() {
                e.push(("blockId", Value::str(&r.block_id)));
            }
            if let Some(d) = &r.data {
                e.push(("data", d.clone()));
            }
            Value::obj(e)
        })
        .collect();
    let logs = sink.logs.borrow().clone();
    ScenarioResult {
        trace,
        writes: vehicle.writes(),
        signals: vehicle.signals(),
        publishes: pubsub.publishes(),
        logs,
    }
}

fn subset(want: &Value, have: Option<&Value>) -> bool {
    match want {
        Value::Object(o) => {
            let Some(h @ Value::Object(_)) = have else {
                return false;
            };
            o.iter().all(|(k, x)| subset(x, h.get(k)))
        }
        _ => have.is_some_and(|h| v::js_json(want) == v::js_json(h)),
    }
}

/// Problems of a result against `scenario.expect` (writes exactly, trace matchers in order).
pub fn check_expectations(result: &ScenarioResult, expect: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    let Some(expect) = expect else { return out };
    if let Some(want) = expect.get("writes") {
        let have = Value::Array(
            result
                .writes
                .iter()
                .map(|w| {
                    Value::obj(vec![
                        ("t", w.get("t").cloned().unwrap_or(Value::Null)),
                        ("path", w.get("path").cloned().unwrap_or(Value::Null)),
                        ("value", w.get("value").cloned().unwrap_or(Value::Null)),
                    ])
                })
                .collect(),
        );
        if v::js_json(&have) != v::js_json(want) {
            out.push(format!(
                "writes differ:\n  expected {}\n  actual   {}",
                v::js_json(want),
                v::js_json(&have)
            ));
        }
    }
    if let Some(Value::Array(matchers)) = expect.get("trace") {
        let mut i = 0;
        for m in matchers {
            while i < result.trace.len() && !subset(m, Some(&result.trace[i])) {
                i += 1;
            }
            if i == result.trace.len() {
                out.push(format!(
                    "trace event {} not found (in order)",
                    v::js_json(m)
                ));
                break;
            }
            i += 1;
        }
    }
    out
}
