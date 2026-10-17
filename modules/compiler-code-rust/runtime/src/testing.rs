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
    /// `scenarioVersion` of the scenario run: 1.1 expectations are a subset with `within` and `never` (ADR-0058 §9).
    pub scenario_version: String,
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
        scenario_version: match scenario.get("scenarioVersion") {
            Some(Value::Str(s)) => s.clone(),
            _ => String::new(),
        },
    }
}

/// Scenario 1.1 and later minor versions (ADR-0058 §9).
pub fn is_scenario_11(version: &str) -> bool {
    let mut parts = version.split('.');
    parts.next() == Some("1")
        && parts
            .next()
            .and_then(|m| m.parse::<u32>().ok())
            .is_some_and(|m| m >= 1)
}

fn int_of(x: Option<&Value>) -> i64 {
    x.map(|x| v::num(x) as i64).unwrap_or(0)
}

/// Indices into `want` that no distinct actual item (same key, in order) matches within `[t, t + within]`.
fn match_in_order(want: &[Value], have: &[Value], key: &dyn Fn(&Value) -> String) -> Vec<usize> {
    let mut used = vec![false; have.len()];
    let mut missing = Vec::new();
    let mut start = 0;
    for (i, w) in want.iter().enumerate() {
        let (k, lo) = (key(w), int_of(w.get("t")));
        let hi = lo + int_of(w.get("within"));
        let found = (start..have.len()).find(|&j| {
            let t = int_of(have[j].get("t"));
            !used[j] && key(&have[j]) == k && t >= lo && t <= hi
        });
        match found {
            Some(j) => {
                used[j] = true;
                start = j + 1;
            }
            None => missing.push(i),
        }
    }
    missing
}

fn within_text(m: &Value) -> String {
    match int_of(m.get("within")) {
        0 => String::new(),
        w => format!(" (within {w} ms)"),
    }
}

fn check_11(result: &ScenarioResult, expect: &Value, out: &mut Vec<String>) {
    let text = |x: Option<&Value>| x.map(v::js_json).unwrap_or_default();
    let plain = |x: Option<&Value>| match x {
        Some(Value::Str(s)) => s.clone(),
        other => text(other),
    };
    if let Some(Value::Array(want)) = expect.get("writes") {
        let key = |w: &Value| format!("{}={}", plain(w.get("path")), text(w.get("value")));
        for i in match_in_order(want, &result.writes, &key) {
            let m = &want[i];
            out.push(format!(
                "expected {} = {} at {} ms{}; actual writes {}",
                plain(m.get("path")),
                text(m.get("value")),
                int_of(m.get("t")),
                within_text(m),
                v::js_json(&Value::Array(result.writes.clone()))
            ));
        }
    }
    if let Some(Value::Array(want)) = expect.get("publishes") {
        let key = |p: &Value| format!("{}\u{0}{}", plain(p.get("topic")), plain(p.get("payload")));
        for i in match_in_order(want, &result.publishes, &key) {
            let m = &want[i];
            out.push(format!(
                "expected a publish on {} ({}) at {} ms{}; actual {}",
                plain(m.get("topic")),
                plain(m.get("payload")),
                int_of(m.get("t")),
                within_text(m),
                v::js_json(&Value::Array(result.publishes.clone()))
            ));
        }
    }
    if let Some(Value::Array(never)) = expect.get("never") {
        for n in never {
            let (path, lo) = (plain(n.get("path")), int_of(n.get("from")));
            let hi = n.get("to").map(|x| v::num(x) as i64);
            let hit = result.writes.iter().find(|w| {
                let t = int_of(w.get("t"));
                plain(w.get("path")) == path && t >= lo && hi.is_none_or(|hi| t <= hi)
            });
            if let Some(hit) = hit {
                let window = if n.get("from").is_some() || n.get("to").is_some() {
                    format!(
                        " in [{lo}, {}] ms",
                        hi.map(|h| h.to_string()).unwrap_or_else(|| "end".into())
                    )
                } else {
                    String::new()
                };
                out.push(format!(
                    "{path} must not be written{window}: written {} at {} ms",
                    text(hit.get("value")),
                    int_of(hit.get("t"))
                ));
            }
        }
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
    let v11 = is_scenario_11(&result.scenario_version);
    if v11 {
        check_11(result, expect, &mut out);
    }
    if let Some(want) = expect.get("writes").filter(|_| !v11) {
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
    if let Some(want) = expect.get("publishes").filter(|_| !v11) {
        let have = Value::Array(
            result
                .publishes
                .iter()
                .map(|p| {
                    Value::obj(vec![
                        ("t", p.get("t").cloned().unwrap_or(Value::Null)),
                        ("topic", p.get("topic").cloned().unwrap_or(Value::Null)),
                        ("payload", p.get("payload").cloned().unwrap_or(Value::Null)),
                    ])
                })
                .collect(),
        );
        if v::js_json(&have) != v::js_json(want) {
            out.push(format!(
                "publishes differ:\n  expected {}\n  actual   {}",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::values::parse_json;

    const H: &str = "Vehicle.Body.Lights.Hazard.IsSignaling";
    const L: &str = "Vehicle.ADAS.LaneDepartureDetection.IsEnabled";

    fn result(writes: &str, publishes: &str, version: &str) -> ScenarioResult {
        let arr = |t: &str| match parse_json(t).unwrap() {
            Value::Array(a) => a,
            _ => vec![],
        };
        ScenarioResult {
            trace: vec![],
            writes: arr(writes),
            signals: vec![],
            publishes: arr(publishes),
            logs: vec![],
            scenario_version: version.into(),
        }
    }

    fn check(r: &ScenarioResult, expect: &str) -> Vec<String> {
        check_expectations(r, Some(&parse_json(expect).unwrap()))
    }

    #[test]
    fn scenario_11_version() {
        assert!(is_scenario_11("1.1.0") && is_scenario_11("1.2.3"));
        assert!(!is_scenario_11("1.0.0") && !is_scenario_11(""));
    }

    #[test]
    fn scenario_11_subset_within_order_never() {
        let w = format!(
            r#"[{{"t":0,"path":"{L}","value":false}},{{"t":2010,"path":"{H}","value":true}},{{"t":2500,"path":"{H}","value":false}}]"#
        );
        let r = result(&w, "[]", "1.1.0");
        let e = |t: u32, within: u32| {
            format!(r#"{{"writes":[{{"t":{t},"path":"{H}","value":true,"within":{within}}}]}}"#)
        };
        assert!(check(&r, &e(2000, 50)).is_empty());
        assert_eq!(check(&r, &e(2000, 0)).len(), 1);
        assert_eq!(check(&r, &e(2020, 100)).len(), 1);
        let exact = result(&w, "[]", "1.0.0");
        assert_eq!(
            check(
                &exact,
                &format!(r#"{{"writes":[{{"t":2010,"path":"{H}","value":true}}]}}"#)
            )
            .len(),
            1
        );
        let twice = format!(
            r#"{{"writes":[{{"t":2010,"path":"{H}","value":true}},{{"t":2010,"path":"{H}","value":true}}]}}"#
        );
        assert_eq!(check(&r, &twice).len(), 1);
        let r = result(
            &format!(r#"[{{"t":500,"path":"{L}","value":true}}]"#),
            "[]",
            "1.1.0",
        );
        assert!(check(&r, &format!(r#"{{"never":[{{"path":"{H}"}}]}}"#)).is_empty());
        assert_eq!(
            check(
                &r,
                &format!(r#"{{"never":[{{"path":"{L}","from":0,"to":1000}}]}}"#)
            ),
            vec![format!(
                "{L} must not be written in [0, 1000] ms: written true at 500 ms"
            )]
        );
        assert!(check(&r, &format!(r#"{{"never":[{{"path":"{L}","from":600}}]}}"#)).is_empty());
    }

    #[test]
    fn scenario_11_publishes() {
        let r = result(
            "[]",
            r#"[{"t":1205,"topic":"app/hmi","payload":"{\"title\":\"Overspeed\"}"}]"#,
            "1.1.0",
        );
        assert!(check(
            &r,
            r#"{"publishes":[{"t":1200,"topic":"app/hmi","payload":"{\"title\":\"Overspeed\"}","within":10}]}"#
        )
        .is_empty());
        assert_eq!(
            check(
                &r,
                r#"{"publishes":[{"t":1200,"topic":"app/hmi","payload":"x","within":10}]}"#
            )
            .len(),
            1
        );
    }
}
