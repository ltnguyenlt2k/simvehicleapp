//! SimVehicleApp runtime for Rust vehicle apps (ADR-0041; execution semantics ADR-0012 + ADR-0017 Notes;
//! executable spec: conformance C01…C38 and the golden traces).
//!
//! A port of the C++ runtime (through the Python port, ADR-0040 Notes §1): generated code declares each
//! workflow with a [`Workflow`] builder — one call per IR trigger and node, expressions as closures over a
//! [`Ctx`] — and the runtime executes it on one [`Strand`]. A run is a set of fibers (the trigger's chain plus
//! parallel branches) sharing a cancel token; a fiber runs synchronously until it waits, then continues from
//! a strand event with its continuation `k`. `stop` and the loop guard end a fiber with `Err(StopRun)`.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::rc::{Rc, Weak};

use crate::strand::Strand;
use crate::values::{self as v, EvalError, Value, R};

/// An IR expression compiled to a closure.
pub type Expr = Box<dyn Fn(&Ctx) -> R>;

// ---- ports ------------------------------------------------------------------------------------------------------

/// The databroker as the runtime sees it (C++ `IVehicleAccess`).
pub trait VehicleAccess {
    fn current(&self, path: &str, ty: &str) -> Option<Value>;
    fn subscribe(&self, path: &str, ty: &str, on_value: Box<dyn Fn(Value)>);
    fn get(&self, path: &str, ty: &str, done: Box<dyn FnOnce(Option<Value>, String)>);
    fn check_write(&self, _path: &str, _ty: &str, _value: &Value) -> String {
        String::new()
    }
    fn set(&self, path: &str, ty: &str, value: Value, done: Option<Box<dyn FnOnce(String)>>);
}

/// Handler of MQTT deliveries: (topic, payload, only_filter).
pub type MqttHandler = Rc<dyn Fn(&str, &str, Option<&str>)>;

/// MQTT as the runtime sees it.
pub trait PubSub {
    fn set_handler(&self, handler: MqttHandler);
    fn subscribe(&self, filter: &str);
    fn publish(&self, topic: &str, payload: &str);
}

#[derive(Clone, Debug)]
pub struct TraceRecord {
    pub seq: u64,
    pub ts: i64,
    pub ev: String,
    pub wf: String,
    pub run: Option<i64>,
    pub node: String,
    pub block_id: String,
    pub data: Option<Value>,
}

pub trait TraceSink {
    fn trace(&self, record: &TraceRecord);
    fn log(&self, ts: i64, level: &str, message: &str);
}

/// `SVTRACE {json}` lines on stdout (ADR-0021 §7, contracts trace-event `runtimeLine`).
pub struct StdoutTraceSink {
    pub app: String,
    /// 0 off, 1 trigger, 2 node.
    pub level: u8,
}

impl StdoutTraceSink {
    pub fn new(app: &str, level: &str) -> Self {
        StdoutTraceSink {
            app: app.to_string(),
            level: level_of(level),
        }
    }

    /// The env (`SV_TRACE_LEVEL`) can lower the level the project was generated with, never raise it.
    pub fn level_from_env(fallback: &str) -> String {
        match std::env::var("SV_TRACE_LEVEL") {
            Ok(env)
                if ["off", "trigger", "node"].contains(&env.as_str())
                    && level_of(&env) < level_of(fallback) =>
            {
                env
            }
            _ => fallback.to_string(),
        }
    }
}

fn level_of(l: &str) -> u8 {
    match l {
        "off" => 0,
        "trigger" => 1,
        _ => 2,
    }
}

pub fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl TraceSink for StdoutTraceSink {
    fn trace(&self, r: &TraceRecord) {
        // Lifecycle events (`app.*`, `vdb.*`) are always written: a live run needs them at every level.
        let lifecycle = r.ev.starts_with("app.") || r.ev.starts_with("vdb.");
        if !lifecycle
            && (self.level == 0 || (self.level == 1 && (r.ev == "enter" || r.ev == "exit")))
        {
            return;
        }
        let mut line = vec![
            ("v", Value::Int(1)),
            ("ts", Value::Int(epoch_ms() as i128)),
            ("app", Value::str(&self.app)),
        ];
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
        use std::io::Write;
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "SVTRACE {}", v::js_json(&Value::obj(line)));
        let _ = out.flush();
    }

    fn log(&self, _ts: i64, level: &str, message: &str) {
        use std::io::Write;
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "[{level}] {message}");
        let _ = out.flush();
    }
}

// ---- declarations -----------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct SignalRef {
    pub id: String,
    pub path: String,
    pub ty: String,
}

#[derive(Clone, Debug)]
pub struct TopicRef {
    pub id: String,
    pub topic: String,
}

#[derive(Clone, Debug)]
pub struct StateRef {
    pub id: String,
    pub ty: String,
}

/// (policy, queueMax, maxRuns) — IR `concurrency`.
pub type Concurrency = (&'static str, usize, usize);

#[derive(Clone, Copy, PartialEq, Debug)]
enum TKind {
    AppStart,
    SignalChanged,
    Timer,
    Condition,
    Mqtt,
}

struct TriggerDef {
    id: String,
    block_id: String,
    kind: TKind,
    wf: Weak<Wf>,
    wf_id: String,
    policy: &'static str,
    queue_max: usize,
    max_runs: usize,
    outputs: Vec<(String, String)>,
    entry: String,
    signal: Option<SignalRef>,
    mode: String,
    threshold: Option<Value>,
    debounce_ms: i64,
    interval_ms: i64,
    initial_delay_ms: i64,
    condition: Option<Expr>,
    topic: Option<TopicRef>,
    json_payload: bool,
}

impl TriggerDef {
    fn key(&self) -> String {
        format!("{}/{}", self.wf_id, self.id)
    }
}

/// `state.filter` state of one node: the window, or the exponential value and sample count.
#[derive(Default)]
struct FilterState {
    window: VecDeque<f64>,
    y: f64,
    count: u32,
}

impl FilterState {
    /// Adds sample `x`; the filtered value and the sample count (same double arithmetic as the simulator).
    fn add(&mut self, x: f64, mode: &str, window: i64, alpha: f64) -> (f64, u32) {
        if mode == "exponential" {
            self.y = if self.count == 0 {
                x
            } else {
                self.y + alpha * (x - self.y)
            };
            self.count = self.count.saturating_add(1);
            return (self.y, self.count);
        }
        self.window.push_back(x);
        if self.window.len() as i64 > window {
            self.window.pop_front();
        }
        self.count = self.window.len() as u32;
        let y = if mode == "median" {
            let mut sorted: Vec<f64> = self.window.iter().copied().collect();
            // stable, equal values (±0) keep their order like the simulator's sort
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let m = sorted.len() / 2;
            if sorted.len() % 2 == 1 {
                sorted[m]
            } else {
                (sorted[m - 1] + sorted[m]) / 2.0
            }
        } else {
            // summed oldest → newest like every runtime
            let mut total = 0.0;
            for v in &self.window {
                total += v;
            }
            total / self.window.len() as f64
        };
        (y, self.count)
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum NKind {
    Read,
    Write,
    Branch,
    Switch,
    Wait,
    WaitUntil,
    StableFor,
    Repeat,
    While,
    Parallel,
    Stop,
    StateGet,
    StateSet,
    Counter,
    Eval,
    InRange,
    Filter,
    Log,
    Publish,
}

struct NodeDef {
    id: String,
    block_id: String,
    kind: NKind,
    next: BTreeMap<String, String>,
    signal: Option<SignalRef>,
    topic: Option<TopicRef>,
    state: Option<StateRef>,
    value: Option<Expr>,
    low: Option<Expr>,
    high: Option<Expr>,
    cases: Vec<Expr>,
    condition: Option<Expr>,
    ms: i64,
    count: i64,
    max_iterations: i64,
    flag: bool,
    on_error_stop: bool,
    has_on_error: bool,
    body: String,
    branches: Vec<String>,
    join: &'static str,
    scope: &'static str,
    counter_op: &'static str,
    filter_mode: &'static str,
    alpha: f64,
    level: Option<String>,
    output: String,
}

impl NodeDef {
    fn new(n: (&str, &str), kind: NKind, next: &[(&str, &str)]) -> Self {
        NodeDef {
            id: n.0.to_string(),
            block_id: n.1.to_string(),
            kind,
            next: next
                .iter()
                .map(|(h, to)| (h.to_string(), to.to_string()))
                .collect(),
            signal: None,
            topic: None,
            state: None,
            value: None,
            low: None,
            high: None,
            cases: Vec::new(),
            condition: None,
            ms: 0,
            count: 0,
            max_iterations: 0,
            flag: false,
            on_error_stop: false,
            has_on_error: false,
            body: String::new(),
            branches: Vec::new(),
            join: "all",
            scope: "run",
            counter_op: "inc",
            filter_mode: "",
            alpha: 0.0,
            level: None,
            output: String::new(),
        }
    }
}

/// A workflow of the app (one generated module).
pub struct Wf {
    pub id: String,
    pub name: String,
    rt: Weak<Inner>,
    me: Weak<Wf>,
    triggers: RefCell<Vec<Rc<TriggerDef>>>,
    nodes: RefCell<HashMap<String, Rc<NodeDef>>>,
    state: RefCell<HashMap<String, Value>>,
    state_initial: RefCell<HashMap<String, Value>>,
}

/// Builder of one workflow; every call mirrors one IR trigger or node.
pub type Workflow = Rc<Wf>;

type Node<'a> = (&'a str, &'a str);
type Next<'a> = &'a [(&'a str, &'a str)];

impl Wf {
    fn inner(&self) -> Rc<Inner> {
        self.rt.upgrade().expect("runtime alive")
    }

    /// A VSS signal of the workflow (IR `signals[]`): id, path, VSS datatype.
    pub fn signal(&self, id: &str, path: &str, ty: &str) -> SignalRef {
        self.inner()
            .path_type
            .borrow_mut()
            .entry(path.to_string())
            .or_insert_with(|| ty.to_string());
        SignalRef {
            id: id.into(),
            path: path.into(),
            ty: ty.into(),
        }
    }

    pub fn topic(&self, id: &str, topic: &str) -> TopicRef {
        TopicRef {
            id: id.into(),
            topic: topic.into(),
        }
    }

    /// A workflow variable shared by all runs of the app; `initial` is its JSON value.
    pub fn state(&self, id: &str, ty: &str, initial: Value) -> StateRef {
        self.state
            .borrow_mut()
            .insert(id.into(), v::from_json(&initial, ty));
        self.state_initial.borrow_mut().insert(id.into(), initial);
        StateRef {
            id: id.into(),
            ty: ty.into(),
        }
    }

    fn trigger(
        &self,
        n: Node,
        kind: TKind,
        c: Concurrency,
        outputs: &[(&str, &str)],
        entry: &str,
        f: impl FnOnce(&mut TriggerDef),
    ) {
        let mut t = TriggerDef {
            id: n.0.into(),
            block_id: n.1.into(),
            kind,
            wf: self.me.clone(),
            wf_id: self.id.clone(),
            policy: c.0,
            queue_max: c.1,
            max_runs: c.2,
            outputs: outputs
                .iter()
                .map(|(k, t)| (k.to_string(), t.to_string()))
                .collect(),
            entry: entry.into(),
            signal: None,
            mode: "any".into(),
            threshold: None,
            debounce_ms: 0,
            interval_ms: 0,
            initial_delay_ms: 0,
            condition: None,
            topic: None,
            json_payload: false,
        };
        f(&mut t);
        self.triggers.borrow_mut().push(Rc::new(t));
    }

    fn add(&self, n: Node, kind: NKind, next: Next, f: impl FnOnce(&mut NodeDef)) {
        let mut d = NodeDef::new(n, kind, next);
        f(&mut d);
        self.nodes.borrow_mut().insert(d.id.clone(), Rc::new(d));
    }

    pub fn on_app_start(&self, n: Node, c: Concurrency, outputs: &[(&str, &str)], entry: &str) {
        self.trigger(n, TKind::AppStart, c, outputs, entry, |_| {});
    }
    #[allow(clippy::too_many_arguments)]
    pub fn on_signal_changed(
        &self,
        n: Node,
        s: &SignalRef,
        mode: &str,
        threshold: Option<Value>,
        debounce_ms: i64,
        c: Concurrency,
        outputs: &[(&str, &str)],
        entry: &str,
    ) {
        self.trigger(n, TKind::SignalChanged, c, outputs, entry, |t| {
            t.signal = Some(s.clone());
            t.mode = mode.into();
            t.threshold = threshold;
            t.debounce_ms = debounce_ms;
        });
    }
    pub fn on_timer(
        &self,
        n: Node,
        interval_ms: i64,
        initial_delay_ms: i64,
        c: Concurrency,
        outputs: &[(&str, &str)],
        entry: &str,
    ) {
        self.trigger(n, TKind::Timer, c, outputs, entry, |t| {
            t.interval_ms = interval_ms;
            t.initial_delay_ms = initial_delay_ms;
        });
    }
    pub fn on_condition(
        &self,
        n: Node,
        condition: Option<Expr>,
        debounce_ms: i64,
        c: Concurrency,
        outputs: &[(&str, &str)],
        entry: &str,
    ) {
        self.trigger(n, TKind::Condition, c, outputs, entry, |t| {
            t.condition = condition;
            t.debounce_ms = debounce_ms;
        });
    }
    pub fn on_mqtt(
        &self,
        n: Node,
        topic: &TopicRef,
        json_payload: bool,
        c: Concurrency,
        outputs: &[(&str, &str)],
        entry: &str,
    ) {
        self.trigger(n, TKind::Mqtt, c, outputs, entry, |t| {
            t.topic = Some(topic.clone());
            t.json_payload = json_payload;
        });
    }
    pub fn read(&self, n: Node, s: &SignalRef, fresh: bool, next: Next) {
        self.add(n, NKind::Read, next, |d| {
            d.signal = Some(s.clone());
            d.flag = fresh;
        });
    }
    pub fn write(
        &self,
        n: Node,
        s: &SignalRef,
        value: Expr,
        await_ack: bool,
        on_error: &str,
        next: Next,
    ) {
        self.add(n, NKind::Write, next, |d| {
            d.signal = Some(s.clone());
            d.value = Some(value);
            d.flag = await_ack;
            d.on_error_stop = on_error == "stop";
            d.has_on_error = true;
        });
    }
    pub fn branch(&self, n: Node, condition: Option<Expr>, next: Next) {
        self.add(n, NKind::Branch, next, |d| d.condition = condition);
    }
    pub fn switch(&self, n: Node, value: Expr, cases: Vec<Expr>, next: Next) {
        self.add(n, NKind::Switch, next, |d| {
            d.value = Some(value);
            d.cases = cases;
        });
    }
    pub fn wait(&self, n: Node, duration_ms: i64, next: Next) {
        self.add(n, NKind::Wait, next, |d| d.ms = duration_ms);
    }
    pub fn wait_until(&self, n: Node, condition: Option<Expr>, timeout_ms: i64, next: Next) {
        self.add(n, NKind::WaitUntil, next, |d| {
            d.condition = condition;
            d.ms = timeout_ms;
        });
    }
    pub fn stable_for(&self, n: Node, condition: Option<Expr>, duration_ms: i64, next: Next) {
        self.add(n, NKind::StableFor, next, |d| {
            d.condition = condition;
            d.ms = duration_ms;
        });
    }
    pub fn repeat(&self, n: Node, count: i64, interval_ms: i64, body: &str, next: Next) {
        self.add(n, NKind::Repeat, next, |d| {
            d.count = count;
            d.ms = interval_ms;
            d.body = body.into();
        });
    }
    pub fn while_loop(
        &self,
        n: Node,
        condition: Option<Expr>,
        max_iterations: i64,
        interval_ms: i64,
        body: &str,
        next: Next,
    ) {
        self.add(n, NKind::While, next, |d| {
            d.condition = condition;
            d.max_iterations = max_iterations;
            d.ms = interval_ms;
            d.body = body.into();
        });
    }
    pub fn parallel(&self, n: Node, branches: &[&str], join: &'static str, next: Next) {
        self.add(n, NKind::Parallel, next, |d| {
            d.branches = branches.iter().map(|b| b.to_string()).collect();
            d.join = join;
        });
    }
    pub fn stop(&self, n: Node, scope: &'static str, next: Next) {
        self.add(n, NKind::Stop, next, |d| d.scope = scope);
    }
    pub fn state_get(&self, n: Node, s: &StateRef, next: Next) {
        self.add(n, NKind::StateGet, next, |d| d.state = Some(s.clone()));
    }
    pub fn state_set(&self, n: Node, s: &StateRef, value: Expr, next: Next) {
        self.add(n, NKind::StateSet, next, |d| {
            d.state = Some(s.clone());
            d.value = Some(value);
        });
    }
    pub fn counter(&self, n: Node, s: &StateRef, op: &'static str, step: i64, next: Next) {
        self.add(n, NKind::Counter, next, |d| {
            d.state = Some(s.clone());
            d.counter_op = op;
            d.count = step;
        });
    }
    pub fn eval(&self, n: Node, output: &str, value: Expr, next: Next) {
        self.add(n, NKind::Eval, next, |d| {
            d.output = output.into();
            d.value = Some(value);
        });
    }
    pub fn in_range(
        &self,
        n: Node,
        value: Expr,
        low: Expr,
        high: Expr,
        hysteresis: bool,
        next: Next,
    ) {
        self.add(n, NKind::InRange, next, |d| {
            d.value = Some(value);
            d.low = Some(low);
            d.high = Some(high);
            d.flag = hysteresis;
        });
    }
    /// `state.filter` (ADR-0049 §1): moving-average / median over `window` samples, or exponential (`alpha`).
    pub fn filter(
        &self,
        n: Node,
        value: Expr,
        mode: &'static str,
        window: i64,
        alpha: f64,
        next: Next,
    ) {
        self.add(n, NKind::Filter, next, |d| {
            d.value = Some(value);
            d.filter_mode = mode;
            d.count = window;
            d.alpha = alpha;
        });
    }
    pub fn log(&self, n: Node, level: Option<&str>, message: Expr, next: Next) {
        self.add(n, NKind::Log, next, |d| {
            d.level = level.map(|l| l.to_string());
            d.value = Some(message);
        });
    }
    pub fn publish(&self, n: Node, topic: &TopicRef, payload: Expr, next: Next) {
        self.add(n, NKind::Publish, next, |d| {
            d.topic = Some(topic.clone());
            d.value = Some(payload);
        });
    }
}

// ---- engine state -------------------------------------------------------------------------------------------------

struct Token {
    cancelled: Cell<bool>,
    children: RefCell<Vec<Rc<Token>>>,
}

impl Token {
    fn new() -> Rc<Token> {
        Rc::new(Token {
            cancelled: Cell::new(false),
            children: RefCell::new(Vec::new()),
        })
    }
    fn cancel(&self) {
        if self.cancelled.get() {
            return;
        }
        self.cancelled.set(true);
        let children = self.children.borrow().clone();
        for c in children {
            c.cancel();
        }
    }
    fn child(parent: &Rc<Token>) -> Rc<Token> {
        let t = Token::new();
        let mut ch = parent.children.borrow_mut();
        // Long-running apps: drop tokens of finished runs now and then.
        if ch.len() >= 64 && ch.len().is_power_of_two() {
            ch.retain(|c| !c.cancelled.get());
        }
        ch.push(t.clone());
        t
    }
}

struct RunState {
    n: i64,
    trigger: Rc<TriggerDef>,
    token: Rc<Token>,
    outputs: RefCell<HashMap<String, Value>>,
    fibers: RefCell<Vec<Rc<Fiber>>>,
    finished: Cell<bool>,
}

/// Ends a fiber (`stop` block, loop guard).
#[derive(Debug)]
pub struct StopRun;
type Flow = Result<(), StopRun>;
type Cont = Box<dyn FnOnce(Option<&'static str>) -> Flow>;

const OK: &str = "ok";
const TIMEOUT: &str = "timeout";
const DONE: &str = "done";

struct Fiber {
    run: Rc<RunState>,
    order: u64,
    token: Rc<Token>,
    done: Cell<bool>,
    waiters: RefCell<Vec<Rc<dyn Fn()>>>,
    on_done: RefCell<Option<Box<dyn FnOnce()>>>,
    k: RefCell<Option<Cont>>,
}

struct Waiter {
    fiber: Rc<Fiber>,
    wf: Rc<Wf>,
    trigger: Rc<TriggerDef>,
    node: Rc<NodeDef>,
    want_true: bool,
    timer: Cell<u64>,
    active: Cell<bool>,
}

// ---- Ctx ----------------------------------------------------------------------------------------------------------

/// Evaluation context of an expression: the current run (if any) and the app state.
pub struct Ctx<'a> {
    rt: &'a Inner,
    wf: &'a Wf,
    run: Option<&'a RunState>,
}

impl<'a> Ctx<'a> {
    /// Output `output` of trigger/node `node` in this run; missing ⇒ `no_value` (ADR-0017 Notes §14).
    pub fn out(&self, node: &str, output: &str) -> R {
        if let Some(run) = self.run {
            if let Some(o) = run.outputs.borrow().get(node) {
                if let Some(x) = o.get(output) {
                    if *x != Value::Null {
                        return Ok(x.clone());
                    }
                }
            }
        }
        Err(EvalError::new(
            "no_value",
            format!("{node}.{output} has no value"),
        ))
    }

    /// Latest value of a signal; none yet ⇒ `no_value`.
    pub fn signal(&self, id: &str, path: &str) -> R {
        match self.rt.values.borrow().get(path) {
            Some(x) if *x != Value::Null => Ok(x.clone()),
            _ => Err(EvalError::new(
                "no_value",
                format!("signal {id} has no value yet"),
            )),
        }
    }

    pub fn state(&self, id: &str) -> R {
        Ok(self
            .wf
            .state
            .borrow()
            .get(id)
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub fn now_ms(&self) -> R {
        Ok(Value::Int(self.rt.strand.now_ms() as i128))
    }
}

// ---- helpers ------------------------------------------------------------------------------------------------------

pub fn topic_matches(filter: &str, topic: &str) -> bool {
    let f: Vec<&str> = filter.split('/').collect();
    let t: Vec<&str> = topic.split('/').collect();
    for (i, part) in f.iter().enumerate() {
        if *part == "#" {
            return true;
        }
        if *part != "+" && (i >= t.len() || *part != t[i]) {
            return false;
        }
    }
    f.len() == t.len()
}

/// `formatValue(v, "")` of the C++ runtime: strings as they are, other values as the simulator prints them.
fn text(x: &Value) -> String {
    match x {
        Value::Str(s) => s.clone(),
        other => v::fmt(other, ""),
    }
}

/// `eq` of the simulator: undefined never equals; integers by decimal text; objects never `===`.
fn same_value(a: Option<&Value>, b: &Value) -> bool {
    let Some(a) = a else { return false };
    if *a == Value::Null || *b == Value::Null {
        return *a == Value::Null && *b == Value::Null;
    }
    if matches!(a, Value::Int(_)) || matches!(b, Value::Int(_)) {
        return text(a) == text(b);
    }
    match (a, b) {
        (Value::Array(_), _) | (Value::Object(_), _) => false,
        (Value::Float(x), Value::Float(y)) => x == y,
        _ => a == b,
    }
}

/// `control.switch` case equality (simulator rule: integers exactly, numbers by value, else strict).
fn switch_match(x: &Value, c: &Value) -> bool {
    if matches!(x, Value::Int(_)) || matches!(c, Value::Int(_)) {
        if text(x) == text(c) && !matches!(c, Value::Str(_)) {
            return true;
        }
        return !matches!(x, Value::Str(_)) && v::num(x) == v::num(c);
    }
    match (x, c) {
        (Value::Float(a), Value::Float(b)) => a == b,
        (Value::Array(_), _) | (Value::Object(_), _) => false,
        _ => std::mem::discriminant(x) == std::mem::discriminant(c) && x == c,
    }
}

// ---- runtime --------------------------------------------------------------------------------------------------

/// Trigger key → its runs, triggers in the order they first ran.
type TriggerRuns = Vec<(String, Vec<Rc<RunState>>)>;
/// A run waiting in a `queue` policy.
type QueuedStart = Box<dyn FnOnce()>;

pub struct Inner {
    pub strand: Rc<Strand>,
    vehicle: Rc<dyn VehicleAccess>,
    pubsub: Rc<dyn PubSub>,
    sink: Rc<dyn TraceSink>,
    me: Weak<Inner>,
    workflows: RefCell<Vec<Rc<Wf>>>,
    values: RefCell<HashMap<String, Value>>,
    path_type: RefCell<BTreeMap<String, String>>,
    trace_seq: Cell<u64>,
    app_token: Rc<Token>,
    /// workflow → trigger key → its runs, triggers in the order they first ran (Map semantics of the simulator)
    runs_of: RefCell<Vec<(String, TriggerRuns)>>,
    queues: RefCell<HashMap<String, VecDeque<QueuedStart>>>,
    waiters: RefCell<Vec<Rc<Waiter>>>,
    condition_last: RefCell<HashMap<String, bool>>,
    debounce: RefCell<HashMap<String, u64>>,
    hysteresis: RefCell<HashMap<String, bool>>,
    filters: RefCell<HashMap<String, FilterState>>,
    subscribed: RefCell<HashSet<String>>,
    current: RefCell<Option<Rc<Fiber>>>,
    fiber_count: Cell<u64>,
    run_count: Cell<i64>,
    stopped: Cell<bool>,
}

/// The app: workflows, signal cache, scheduler of runs. One per process or per test.
#[derive(Clone)]
pub struct Runtime(pub Rc<Inner>);

impl Runtime {
    pub fn new(
        strand: Rc<Strand>,
        vehicle: Rc<dyn VehicleAccess>,
        pubsub: Rc<dyn PubSub>,
        sink: Rc<dyn TraceSink>,
    ) -> Runtime {
        Runtime(Rc::new_cyclic(|me| Inner {
            strand,
            vehicle,
            pubsub,
            sink,
            me: me.clone(),
            workflows: RefCell::new(Vec::new()),
            values: RefCell::new(HashMap::new()),
            path_type: RefCell::new(BTreeMap::new()),
            trace_seq: Cell::new(0),
            app_token: Token::new(),
            runs_of: RefCell::new(Vec::new()),
            queues: RefCell::new(HashMap::new()),
            waiters: RefCell::new(Vec::new()),
            condition_last: RefCell::new(HashMap::new()),
            debounce: RefCell::new(HashMap::new()),
            hysteresis: RefCell::new(HashMap::new()),
            filters: RefCell::new(HashMap::new()),
            subscribed: RefCell::new(HashSet::new()),
            current: RefCell::new(None),
            fiber_count: Cell::new(0),
            run_count: Cell::new(0),
            stopped: Cell::new(false),
        }))
    }

    /// Declares a workflow (generated `bind`); workflows run in declaration order.
    pub fn workflow(&self, id: &str, name: &str) -> Workflow {
        let wf = Rc::new_cyclic(|me| Wf {
            id: id.into(),
            name: name.into(),
            rt: Rc::downgrade(&self.0),
            me: me.clone(),
            triggers: RefCell::new(Vec::new()),
            nodes: RefCell::new(HashMap::new()),
            state: RefCell::new(HashMap::new()),
            state_initial: RefCell::new(HashMap::new()),
        });
        self.0.workflows.borrow_mut().push(wf.clone());
        wf
    }

    /// Reads the baselines, subscribes signals and topics, posts the app start on the strand.
    pub fn start(&self) {
        let rt = &self.0;
        let paths: Vec<(String, String)> = rt
            .path_type
            .borrow()
            .iter()
            .map(|(p, t)| (p.clone(), t.clone()))
            .collect();
        for (path, ty) in &paths {
            if let Some(x) = rt.vehicle.current(path, ty) {
                rt.values.borrow_mut().insert(path.clone(), x);
            }
        }
        for (path, ty) in &paths {
            let weak = rt.me.clone();
            let p = path.clone();
            rt.vehicle.subscribe(
                path,
                ty,
                Box::new(move |x| {
                    if let Some(rt) = weak.upgrade() {
                        rt.apply_input(&p, x);
                    }
                }),
            );
        }
        let weak = rt.me.clone();
        rt.pubsub.set_handler(Rc::new(move |topic, payload, only| {
            if let Some(rt) = weak.upgrade() {
                rt.deliver_mqtt(topic, payload, only);
            }
        }));
        for t in rt.triggers() {
            if t.kind == TKind::Mqtt {
                let topic = t.topic.as_ref().unwrap().topic.clone();
                if rt.subscribed.borrow_mut().insert(topic.clone()) {
                    rt.pubsub.subscribe(&topic);
                }
            }
        }
        let weak = rt.me.clone();
        rt.strand.post_at(0, move || {
            if let Some(rt) = weak.upgrade() {
                rt.start_app();
            }
        });
    }

    /// Cancels every run; the strand keeps running other events.
    pub fn stop_all(&self) {
        self.0.stopped.set(true);
        self.0.app_token.cancel();
    }

    pub fn stopped(&self) -> bool {
        self.0.stopped.get()
    }

    /// Path ⇒ VSS datatype of every signal the workflows declared.
    pub fn signals(&self) -> BTreeMap<String, String> {
        self.0.path_type.borrow().clone()
    }

    /// `vdb.connected`, `app.started`, `app.stopping` (no workflow, no run).
    pub fn trace_lifecycle(&self, ev: &str) {
        self.0.sink.trace(&TraceRecord {
            seq: 0,
            ts: epoch_ms(),
            ev: ev.into(),
            wf: String::new(),
            run: None,
            node: String::new(),
            block_id: String::new(),
            data: None,
        });
    }

    /// A value the vehicle reported (subscriptions, scenario inputs), on the strand.
    pub fn apply_input(&self, path: &str, value: Value) {
        self.0.apply_input(path, value);
    }
}

impl Inner {
    fn rc(&self) -> Rc<Inner> {
        self.me.upgrade().expect("runtime alive")
    }

    fn now(&self) -> i64 {
        self.strand.now_ms()
    }

    fn schedule(&self, at: i64, f: impl FnOnce(&Rc<Inner>) + 'static) -> u64 {
        let weak = self.me.clone();
        self.strand.post_at(at, move || {
            if let Some(rt) = weak.upgrade() {
                f(&rt);
            }
        })
    }

    fn triggers(&self) -> Vec<Rc<TriggerDef>> {
        self.workflows
            .borrow()
            .iter()
            .flat_map(|w| w.triggers.borrow().clone())
            .collect()
    }

    fn wf_of(t: &TriggerDef) -> Rc<Wf> {
        t.wf.upgrade().expect("workflow alive")
    }

    // ---- tracing
    fn trace(
        &self,
        ev: &str,
        run: Option<&RunState>,
        wf: &str,
        node: &str,
        block_id: &str,
        data: Option<Value>,
    ) {
        let seq = self.trace_seq.get();
        self.trace_seq.set(seq + 1);
        let has = run.is_some() || !node.is_empty();
        let rec = TraceRecord {
            seq,
            ts: self.now(),
            ev: ev.into(),
            wf: if has { wf.into() } else { String::new() },
            run: if has {
                Some(run.map(|r| r.n).unwrap_or(0))
            } else {
                None
            },
            node: node.into(),
            block_id: block_id.into(),
            data,
        };
        self.sink.trace(&rec);
    }

    fn trace_node(&self, ev: &str, run: &RunState, node: &NodeDef, data: Option<Value>) {
        self.trace(
            ev,
            Some(run),
            &run.trigger.wf_id,
            &node.id,
            &node.block_id,
            data,
        );
    }

    // ---- inputs, signals, triggers
    fn start_app(&self) {
        for t in self.triggers() {
            match t.kind {
                TKind::AppStart => self.fire(&t, Value::Object(vec![])),
                TKind::Timer => self.schedule_tick(&t, t.initial_delay_ms, 1),
                TKind::Condition => {
                    let wf = Self::wf_of(&t);
                    let now = self.safe_cond(&wf, None, t.condition.as_ref());
                    self.condition_last.borrow_mut().insert(t.key(), now);
                }
                _ => {}
            }
        }
    }

    fn schedule_tick(&self, t: &Rc<TriggerDef>, at: i64, tick: i64) {
        let t = t.clone();
        self.schedule(at, move |rt| {
            rt.fire(
                &t,
                Value::obj(vec![
                    ("tick", Value::Int(tick as i128)),
                    ("timestamp", Value::Int(rt.now() as i128)),
                ]),
            );
            rt.schedule_tick(&t, at + t.interval_ms, tick + 1);
        });
    }

    fn mode_matches(&self, t: &TriggerDef, prev: Option<&Value>, next: &Value) -> bool {
        let n = v::num;
        let nan = Value::Float(f64::NAN);
        let th = t.threshold.as_ref().unwrap_or(&nan);
        match t.mode.as_str() {
            "any" => !same_value(prev, next),
            "rising" => prev.is_some_and(|p| n(next) > n(p)),
            "falling" => prev.is_some_and(|p| n(next) < n(p)),
            "crosses_above" => prev.is_some_and(|p| n(p) <= n(th) && n(th) < n(next)),
            "crosses_below" => prev.is_some_and(|p| n(p) >= n(th) && n(th) > n(next)),
            "becomes" => {
                t.threshold.is_some() && same_value(Some(next), th) && !same_value(prev, th)
            }
            _ => false,
        }
    }

    fn apply_input(&self, path: &str, incoming: Value) {
        if !self.path_type.borrow().contains_key(path) {
            return; // a signal the app does not use
        }
        let prev = self
            .values
            .borrow_mut()
            .insert(path.to_string(), incoming.clone());
        for t in self.triggers() {
            if t.kind != TKind::SignalChanged || t.signal.as_ref().unwrap().path != path {
                continue;
            }
            if !self.mode_matches(&t, prev.as_ref(), &incoming) {
                continue;
            }
            let outputs = Value::obj(vec![
                ("value", incoming.clone()),
                ("previous", prev.clone().unwrap_or(Value::Null)),
                ("timestamp", Value::Int(self.now() as i128)),
            ]);
            if t.debounce_ms > 0 {
                if let Some(old) = self.debounce.borrow_mut().remove(&t.key()) {
                    self.strand.cancel(old);
                }
                let (tt, p) = (t.clone(), path.to_string());
                let id = self.schedule(self.now() + t.debounce_ms, move |rt| {
                    rt.debounce.borrow_mut().remove(&tt.key());
                    let mut o = outputs;
                    o.set(
                        "value",
                        rt.values.borrow().get(&p).cloned().unwrap_or(Value::Null),
                    );
                    o.set("timestamp", Value::Int(rt.now() as i128));
                    rt.fire(&tt, o);
                });
                self.debounce.borrow_mut().insert(t.key(), id);
            } else {
                self.fire(&t, outputs);
            }
        }
        self.after_change();
    }

    /// After a signal/state change: condition triggers (rising edge) and waiting fibers.
    fn after_change(&self) {
        for t in self.triggers() {
            if t.kind != TKind::Condition {
                continue;
            }
            let wf = Self::wf_of(&t);
            let now_true = self.safe_cond(&wf, None, t.condition.as_ref());
            let before = self
                .condition_last
                .borrow_mut()
                .insert(t.key(), now_true)
                .unwrap_or(false);
            if now_true && !before {
                if t.debounce_ms > 0 {
                    let tt = t.clone();
                    let id = self.schedule(self.now() + t.debounce_ms, move |rt| {
                        rt.debounce.borrow_mut().remove(&tt.key());
                        let wf = Inner::wf_of(&tt);
                        if rt.safe_cond(&wf, None, tt.condition.as_ref()) {
                            rt.fire(
                                &tt,
                                Value::obj(vec![("timestamp", Value::Int(rt.now() as i128))]),
                            );
                        }
                    });
                    self.debounce.borrow_mut().insert(t.key(), id);
                } else {
                    self.fire(
                        &t,
                        Value::obj(vec![("timestamp", Value::Int(self.now() as i128))]),
                    );
                }
            } else if !now_true {
                if let Some(id) = self.debounce.borrow_mut().remove(&t.key()) {
                    self.strand.cancel(id);
                }
            }
        }
        let waiters = self.waiters.borrow().clone();
        for w in waiters {
            // A nested change (a resumed run that sets state) may already have resumed or dropped it.
            if !w.active.get() {
                continue;
            }
            if w.fiber.token.cancelled.get() {
                self.remove_waiter(&w);
                continue;
            }
            if self.safe_cond(&w.wf, Some(&w.fiber.run), w.node.condition.as_ref()) == w.want_true {
                self.remove_waiter(&w);
                self.strand.cancel(w.timer.get());
                self.step(&w.fiber, Some(OK));
            }
        }
        let _ = &self.current;
    }

    fn remove_waiter(&self, w: &Rc<Waiter>) {
        w.active.set(false);
        self.waiters.borrow_mut().retain(|x| !Rc::ptr_eq(x, w));
    }

    fn deliver_mqtt(&self, topic: &str, payload: &str, only: Option<&str>) {
        for t in self.triggers() {
            if t.kind != TKind::Mqtt {
                continue;
            }
            let filter = &t.topic.as_ref().unwrap().topic;
            let matched = match only {
                Some(f) => filter == f,
                None => topic_matches(filter, topic),
            };
            if !matched {
                continue;
            }
            let value = if t.json_payload {
                match v::js_parse(payload) {
                    Ok(x) => x,
                    Err(_) => {
                        self.trace(
                            "error",
                            None,
                            &t.wf_id,
                            &t.id,
                            &t.block_id,
                            Some(Value::obj(vec![
                                ("reason", Value::str("payload_not_json")),
                                ("topic", Value::str(topic)),
                            ])),
                        );
                        continue;
                    }
                }
            } else {
                Value::str(payload)
            };
            self.fire(
                &t,
                Value::obj(vec![("payload", value), ("topic", Value::str(topic))]),
            );
        }
    }

    // ---- concurrency
    fn with_runs<T>(&self, t: &TriggerDef, f: impl FnOnce(&mut Vec<Rc<RunState>>) -> T) -> T {
        let mut all = self.runs_of.borrow_mut();
        let wi = match all.iter().position(|(w, _)| *w == t.wf_id) {
            Some(i) => i,
            None => {
                all.push((t.wf_id.clone(), Vec::new()));
                all.len() - 1
            }
        };
        let list = &mut all[wi].1;
        let ti = match list.iter().position(|(k, _)| *k == t.key()) {
            Some(i) => i,
            None => {
                list.push((t.key(), Vec::new()));
                list.len() - 1
            }
        };
        f(&mut list[ti].1)
    }

    fn active(&self, t: &TriggerDef) -> Vec<Rc<RunState>> {
        self.with_runs(t, |runs| {
            runs.iter().filter(|r| !r.finished.get()).cloned().collect()
        })
    }

    fn fire(&self, t: &Rc<TriggerDef>, outputs: Value) {
        if self.stopped.get() {
            return;
        }
        let act = self.active(t);
        if t.kind == TKind::AppStart || act.is_empty() {
            return self.start_run(t, outputs);
        }
        match t.policy {
            "restart" => {
                for r in act {
                    self.cancel_run(&r, "restart");
                }
                self.start_run(t, outputs);
            }
            "ignore" => {}
            "queue" => {
                let overflow = {
                    let mut q = self.queues.borrow_mut();
                    let q = q.entry(t.key()).or_default();
                    let over = q.len() >= t.queue_max;
                    if over {
                        q.pop_front();
                    }
                    over
                };
                if overflow {
                    self.trace(
                        "error",
                        None,
                        &t.wf_id,
                        &t.id,
                        &t.block_id,
                        Some(Value::obj(vec![("reason", Value::str("queue_overflow"))])),
                    );
                }
                let (weak, tt) = (self.me.clone(), t.clone());
                self.queues
                    .borrow_mut()
                    .entry(t.key())
                    .or_default()
                    .push_back(Box::new(move || {
                        if let Some(rt) = weak.upgrade() {
                            rt.start_run(&tt, outputs);
                        }
                    }));
            }
            _ => {
                if act.len() < t.max_runs {
                    self.start_run(t, outputs);
                }
            }
        }
    }

    fn start_run(&self, t: &Rc<TriggerDef>, outputs: Value) {
        self.run_count.set(self.run_count.get() + 1);
        let run = Rc::new(RunState {
            n: self.run_count.get(),
            trigger: t.clone(),
            token: Token::child(&self.app_token),
            outputs: RefCell::new(HashMap::from([(t.id.clone(), outputs.clone())])),
            fibers: RefCell::new(Vec::new()),
            finished: Cell::new(false),
        });
        self.with_runs(t, |runs| {
            runs.retain(|r| !r.finished.get());
            runs.push(run.clone());
        });
        let json = match &outputs {
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, x)| {
                        let ty = t
                            .outputs
                            .iter()
                            .find(|(n, _)| n == k)
                            .map(|(_, ty)| ty.as_str())
                            .unwrap_or("");
                        (k.clone(), v::to_json(x, Some(ty)))
                    })
                    .collect(),
            ),
            other => other.clone(),
        };
        self.trace(
            "trigger",
            Some(&run),
            &t.wf_id,
            &t.id,
            &t.block_id,
            Some(Value::obj(vec![("outputs", json)])),
        );
        self.spawn(&run, run.token.clone(), t.entry.clone());
    }

    fn cancel_run(&self, run: &Rc<RunState>, reason: &str) {
        if run.finished.get() {
            return;
        }
        run.token.cancel();
        run.finished.set(true);
        let t = &run.trigger;
        self.trace(
            "cancel",
            Some(run),
            &t.wf_id,
            &t.id,
            &t.block_id,
            Some(Value::obj(vec![("reason", Value::str(reason))])),
        );
        // Its waiting fibers end now: a long-running app must not keep one per restart.
        let current = self.current.borrow().clone();
        self.reap(run, current.as_ref());
    }

    fn finish_run(&self, run: &Rc<RunState>) {
        if run.finished.get() {
            return;
        }
        run.finished.set(true);
        let next = self
            .queues
            .borrow_mut()
            .get_mut(&run.trigger.key())
            .and_then(|q| q.pop_front());
        if let Some(start) = next {
            start();
        }
    }

    // ---- fibers
    fn new_fiber(&self, run: &Rc<RunState>, token: Rc<Token>) -> Rc<Fiber> {
        self.fiber_count.set(self.fiber_count.get() + 1);
        let f = Rc::new(Fiber {
            run: run.clone(),
            order: self.fiber_count.get(),
            token,
            done: Cell::new(false),
            waiters: RefCell::new(Vec::new()),
            on_done: RefCell::new(None),
            k: RefCell::new(None),
        });
        run.fibers.borrow_mut().push(f.clone());
        let (weak, r, ff) = (self.me.clone(), run.clone(), Rc::downgrade(&f));
        *f.on_done.borrow_mut() = Some(Box::new(move || {
            if let Some(f) = ff.upgrade() {
                r.fibers.borrow_mut().retain(|x| !Rc::ptr_eq(x, &f));
            }
            if r.fibers.borrow().is_empty() {
                if let Some(rt) = weak.upgrade() {
                    rt.finish_run(&r);
                }
            }
        }));
        f
    }

    fn chain_k(&self, f: &Rc<Fiber>, entry: String) -> Cont {
        let (rt, ff) = (self.rc(), f.clone());
        Box::new(move |_| {
            let f2 = ff.clone();
            let rt2 = rt.clone();
            rt.chain(
                &ff,
                entry,
                Box::new(move || {
                    rt2.complete(&f2);
                    Ok(())
                }),
            )
        })
    }

    fn spawn(&self, run: &Rc<RunState>, token: Rc<Token>, entry: String) {
        let f = self.new_fiber(run, token);
        *f.k.borrow_mut() = Some(self.chain_k(&f, entry));
        self.step(&f, None);
    }

    /// Parallel branch: a child fiber started at the same instant, after the parent's current step.
    fn spawn_later(&self, run: &Rc<RunState>, entry: String) -> Rc<Fiber> {
        let f = self.new_fiber(run, Token::child(&run.token));
        *f.k.borrow_mut() = Some(self.chain_k(&f, entry));
        let ff = f.clone();
        self.schedule(self.now(), move |rt| rt.step(&ff, None));
        f
    }

    fn step(&self, f: &Rc<Fiber>, resume: Option<&'static str>) {
        if f.done.get() {
            f.k.borrow_mut().take();
            return;
        }
        if f.token.cancelled.get() {
            return self.complete(f);
        }
        let Some(k) = f.k.borrow_mut().take() else {
            return;
        };
        let outer = self.current.replace(Some(f.clone()));
        let result = k(resume);
        *self.current.borrow_mut() = outer;
        if result.is_err() {
            self.complete(f);
        }
    }

    /// Cancelled fibers end when they are cancelled, so the run ends as soon as its last live fiber does.
    fn reap(&self, run: &RunState, except: Option<&Rc<Fiber>>) {
        let mut live: Vec<Rc<Fiber>> = run
            .fibers
            .borrow()
            .iter()
            .filter(|f| {
                except.is_none_or(|e| !Rc::ptr_eq(e, f)) && f.token.cancelled.get() && !f.done.get()
            })
            .cloned()
            .collect();
        live.sort_by_key(|f| f.order);
        for f in live {
            self.complete(&f);
        }
    }

    fn complete(&self, f: &Rc<Fiber>) {
        if f.done.get() {
            return;
        }
        f.done.set(true);
        f.k.borrow_mut().take();
        let waiters = f.waiters.borrow().clone();
        for w in waiters {
            w();
        }
        let on_done = f.on_done.borrow_mut().take();
        if let Some(d) = on_done {
            d();
        }
    }

    fn sleep(&self, f: &Rc<Fiber>, ms: i64, k: Cont) {
        *f.k.borrow_mut() = Some(k);
        let ff = f.clone();
        self.schedule(self.now() + ms, move |rt| rt.step(&ff, None));
    }

    fn until(
        &self,
        f: &Rc<Fiber>,
        wf: &Rc<Wf>,
        node: &Rc<NodeDef>,
        timeout_ms: i64,
        want_true: bool,
        k: Cont,
    ) {
        *f.k.borrow_mut() = Some(k);
        let w = Rc::new(Waiter {
            fiber: f.clone(),
            wf: wf.clone(),
            trigger: f.run.trigger.clone(),
            node: node.clone(),
            want_true,
            timer: Cell::new(0),
            active: Cell::new(true),
        });
        let ww = w.clone();
        let id = self.schedule(self.now() + timeout_ms, move |rt| {
            if !ww.active.get() {
                return;
            }
            rt.remove_waiter(&ww);
            rt.step(&ww.fiber, Some(TIMEOUT));
        });
        w.timer.set(id);
        let _ = &w.trigger;
        self.waiters.borrow_mut().push(w);
    }

    fn join(&self, f: &Rc<Fiber>, children: Vec<Rc<Fiber>>, mode: &'static str, k: Cont) {
        *f.k.borrow_mut() = Some(k);
        let pending: Vec<Rc<Fiber>> = children.iter().filter(|c| !c.done.get()).cloned().collect();
        let resume = |rt: &Inner, f: &Rc<Fiber>| {
            let ff = f.clone();
            rt.schedule(rt.now(), move |rt| rt.step(&ff, Some(DONE)));
        };
        if mode == "all" && pending.is_empty() {
            return resume(self, f);
        }
        if mode == "any" && pending.len() < children.len() {
            for c in &pending {
                c.token.cancel();
            }
            self.reap(&f.run, None);
            return resume(self, f);
        }
        let resumed = Rc::new(Cell::new(false));
        let children = Rc::new(children);
        for c in &pending {
            let (weak, ff, kids, done) = (
                self.me.clone(),
                f.clone(),
                children.clone(),
                resumed.clone(),
            );
            c.waiters.borrow_mut().push(Rc::new(move || {
                if done.get() {
                    return;
                }
                let Some(rt) = weak.upgrade() else { return };
                let left: Vec<Rc<Fiber>> = kids.iter().filter(|x| !x.done.get()).cloned().collect();
                if mode == "any" || left.is_empty() {
                    done.set(true);
                    if mode == "any" {
                        for x in &left {
                            x.token.cancel();
                        }
                        rt.reap(&ff.run, None);
                    }
                    let f2 = ff.clone();
                    rt.schedule(rt.now(), move |rt| rt.step(&f2, Some(DONE)));
                }
            }));
        }
    }

    // ---- evaluation
    fn eval(&self, wf: &Wf, run: Option<&RunState>, e: &Expr) -> R {
        e(&Ctx { rt: self, wf, run })
    }

    fn safe_cond(&self, wf: &Wf, run: Option<&RunState>, cond: Option<&Expr>) -> bool {
        match cond {
            None => false,
            Some(c) => self.eval(wf, run, c).map(|x| x.is_true()).unwrap_or(false),
        }
    }

    // ---- interpreter
    /// Runs the chain from `id`; `end` runs when it returns (normally or because the run was cancelled).
    fn chain(&self, f: &Rc<Fiber>, id: String, end: Box<dyn FnOnce() -> Flow>) -> Flow {
        let run = f.run.clone();
        if id.is_empty() || run.token.cancelled.get() {
            return end();
        }
        let wf = Self::wf_of(&run.trigger);
        let node = wf
            .nodes
            .borrow()
            .get(&id)
            .cloned()
            .unwrap_or_else(|| panic!("node {id} of {}", wf.id));
        self.trace_node("enter", &run, &node, None);
        let (rt, ff, nd) = (self.rc(), f.clone(), node.clone());
        let k: Cont = Box::new(move |handle| {
            let r = ff.run.clone();
            if r.token.cancelled.get() {
                return end();
            }
            match handle {
                Some(h) => rt.trace_node(
                    "exit",
                    &r,
                    &nd,
                    Some(Value::obj(vec![("handle", Value::str(h))])),
                ),
                None => rt.trace_node("exit", &r, &nd, None),
            }
            let next = handle
                .and_then(|h| nd.next.get(h).cloned())
                .unwrap_or_default();
            rt.chain(&ff, next, end)
        });
        self.exec(f, &wf, &node, k)
    }

    /// I/O error: `error` branch when connected, else `onError` (continue = log + next, stop = end run).
    fn on_error(
        &self,
        run: &RunState,
        node: &NodeDef,
        reason: &str,
        message: &str,
    ) -> Option<&'static str> {
        {
            let mut outs = run.outputs.borrow_mut();
            let o = outs
                .entry(node.id.clone())
                .or_insert_with(|| Value::Object(vec![]));
            o.set("ok", Value::Bool(false));
            o.set("error", Value::str(message));
        }
        self.trace_node(
            "error",
            run,
            node,
            Some(Value::obj(vec![
                ("reason", Value::str(reason)),
                ("message", Value::str(message)),
            ])),
        );
        if node.next.get("error").is_some_and(|to| !to.is_empty()) {
            return Some("error");
        }
        if node.has_on_error && node.on_error_stop {
            return None;
        }
        if node.next.contains_key("next") {
            return Some("next");
        }
        None
    }

    fn set_output(run: &RunState, node: &NodeDef, value: Value) {
        run.outputs.borrow_mut().insert(node.id.clone(), value);
    }

    fn exec(&self, f: &Rc<Fiber>, wf: &Rc<Wf>, node: &Rc<NodeDef>, k: Cont) -> Flow {
        let run = f.run.clone();
        let fail = |e: EvalError, k: Cont| k(self.on_error(&run, node, e.reason, &e.message));
        let ev = |e: &Option<Expr>| self.eval(wf, Some(&run), e.as_ref().expect("expression"));
        match node.kind {
            NKind::Write => {
                let s = node.signal.as_ref().unwrap();
                let x = match ev(&node.value) {
                    Ok(x) => x,
                    Err(e) => return fail(e, k),
                };
                let rejected = self.vehicle.check_write(&s.path, &s.ty, &x);
                if !rejected.is_empty() {
                    return fail(EvalError::new("no_value", rejected), k);
                }
                if !node.flag {
                    self.vehicle.set(&s.path, &s.ty, x.clone(), None);
                }
                self.trace_node(
                    "write",
                    &run,
                    node,
                    Some(Value::obj(vec![
                        ("path", Value::str(&s.path)),
                        ("value", v::to_json(&x, Some(&s.ty))),
                    ])),
                );
                Self::set_output(
                    &run,
                    node,
                    Value::obj(vec![("ok", Value::Bool(true)), ("error", Value::str(""))]),
                );
                if !node.flag {
                    return k(Some("next"));
                }
                let error = Rc::new(RefCell::new(String::new()));
                let (rt, ff, nd, err) = (self.rc(), f.clone(), node.clone(), error.clone());
                *f.k.borrow_mut() = Some(Box::new(move |_| {
                    let e = err.borrow().clone();
                    if !e.is_empty() {
                        let h = rt.on_error(&ff.run, &nd, "write_failed", &e);
                        return k(h);
                    }
                    k(Some("next"))
                }));
                let (weak, ff) = (self.me.clone(), f.clone());
                self.vehicle.set(
                    &s.path,
                    &s.ty,
                    x,
                    Some(Box::new(move |e| {
                        *error.borrow_mut() = e;
                        if let Some(rt) = weak.upgrade() {
                            rt.step(&ff, None);
                        }
                    })),
                );
                Ok(())
            }
            NKind::Read => {
                let s = node.signal.clone().unwrap();
                let (rt, ff, nd) = (self.rc(), f.clone(), node.clone());
                let finish = move |x: Option<Value>, k: Cont| -> Flow {
                    match x {
                        Some(x) if x != Value::Null => {
                            Inner::set_output(
                                &ff.run,
                                &nd,
                                Value::obj(vec![
                                    ("value", x),
                                    ("timestamp", Value::Int(rt.now() as i128)),
                                ]),
                            );
                            k(Some("next"))
                        }
                        _ => {
                            let h = rt.on_error(
                                &ff.run,
                                &nd,
                                "no_value",
                                &format!("{} has no value yet", nd.signal.as_ref().unwrap().path),
                            );
                            k(h)
                        }
                    }
                };
                if !node.flag {
                    let x = self.values.borrow().get(&s.path).cloned();
                    return finish(x, k);
                }
                let got: Rc<RefCell<(Option<Value>, String)>> =
                    Rc::new(RefCell::new((None, String::new())));
                let (rt, ff, nd, g) = (self.rc(), f.clone(), node.clone(), got.clone());
                *f.k.borrow_mut() = Some(Box::new(move |_| {
                    let (x, e) = g.borrow().clone();
                    if !e.is_empty() {
                        let h = rt.on_error(&ff.run, &nd, "read_failed", &e);
                        return k(h);
                    }
                    finish(x, k)
                }));
                let (weak, ff) = (self.me.clone(), f.clone());
                self.vehicle.get(
                    &s.path,
                    &s.ty,
                    Box::new(move |x, e| {
                        *got.borrow_mut() = (x, e);
                        if let Some(rt) = weak.upgrade() {
                            rt.step(&ff, None);
                        }
                    }),
                );
                Ok(())
            }
            NKind::Branch => {
                let b = match &node.condition {
                    None => false,
                    Some(c) => match self.eval(wf, Some(&run), c) {
                        Ok(x) => x.is_true(),
                        Err(e) => return fail(e, k),
                    },
                };
                k(Some(if b { "then" } else { "else" }))
            }
            NKind::Switch => {
                let x = match ev(&node.value) {
                    Ok(x) => x,
                    Err(e) => return fail(e, k),
                };
                for (i, case) in node.cases.iter().enumerate() {
                    match self.eval(wf, Some(&run), case) {
                        Ok(c) if switch_match(&x, &c) => return k(Some(leak(format!("case_{i}")))),
                        Ok(_) => {}
                        Err(e) => return fail(e, k),
                    }
                }
                k(Some("default"))
            }
            NKind::Wait => {
                self.sleep(f, node.ms, Box::new(move |_| k(Some("next"))));
                Ok(())
            }
            NKind::WaitUntil => {
                if self.safe_cond(wf, Some(&run), node.condition.as_ref()) {
                    return k(Some("ok"));
                }
                self.until(
                    f,
                    wf,
                    node,
                    node.ms,
                    true,
                    Box::new(move |r| k(Some(if r == Some(OK) { "ok" } else { "timeout" }))),
                );
                Ok(())
            }
            NKind::StableFor => {
                if !self.safe_cond(wf, Some(&run), node.condition.as_ref()) {
                    return k(Some("broken"));
                }
                self.until(
                    f,
                    wf,
                    node,
                    node.ms,
                    false,
                    Box::new(move |r| k(Some(if r == Some(OK) { "broken" } else { "stable" }))),
                );
                Ok(())
            }
            NKind::Repeat => self.repeat_step(f, node, 0, k),
            NKind::While => self.while_step(f, node, 0, k),
            NKind::Parallel => {
                let children: Vec<Rc<Fiber>> = node
                    .branches
                    .iter()
                    .map(|b| self.spawn_later(&run, b.clone()))
                    .collect();
                if node.join == "none" {
                    return k(Some("next"));
                }
                self.join(f, children, node.join, Box::new(move |_| k(Some("next"))));
                Ok(())
            }
            NKind::Stop => {
                if node.scope == "app" {
                    self.stopped.set(true);
                    self.app_token.cancel();
                    self.strand.stop();
                } else if node.scope == "workflow" {
                    let runs: Vec<Rc<RunState>> = self
                        .runs_of
                        .borrow()
                        .iter()
                        .filter(|(w, _)| *w == wf.id)
                        .flat_map(|(_, list)| list.iter().flat_map(|(_, rs)| rs.clone()))
                        .collect();
                    for r in runs {
                        if !Rc::ptr_eq(&r, &run) {
                            self.cancel_run(&r, "stop");
                        }
                    }
                }
                run.token.cancel();
                let current = self.current.borrow().clone();
                self.reap(&run, current.as_ref());
                Err(StopRun)
            }
            NKind::StateGet => {
                let x = wf
                    .state
                    .borrow()
                    .get(&node.state.as_ref().unwrap().id)
                    .cloned()
                    .unwrap_or(Value::Null);
                Self::set_output(&run, node, Value::obj(vec![("value", x)]));
                k(Some("next"))
            }
            NKind::StateSet => {
                let x = match ev(&node.value) {
                    Ok(x) => x,
                    Err(e) => return fail(e, k),
                };
                wf.state
                    .borrow_mut()
                    .insert(node.state.as_ref().unwrap().id.clone(), x);
                self.after_change();
                k(Some("next"))
            }
            NKind::Counter => {
                let s = node.state.as_ref().unwrap();
                let next = if node.counter_op == "reset" {
                    v::from_json(
                        wf.state_initial.borrow().get(&s.id).unwrap_or(&Value::Null),
                        &s.ty,
                    )
                } else {
                    let cur = match wf.state.borrow().get(&s.id) {
                        Some(Value::Int(i)) => *i,
                        Some(other) => v::num(other).trunc() as i128,
                        None => 0,
                    };
                    let step = node.count as i128;
                    v::cast(
                        &Value::Int(if node.counter_op == "dec" {
                            cur - step
                        } else {
                            cur + step
                        }),
                        &s.ty,
                        "",
                    )
                };
                wf.state.borrow_mut().insert(s.id.clone(), next.clone());
                Self::set_output(&run, node, Value::obj(vec![("value", next)]));
                self.after_change();
                k(Some("next"))
            }
            NKind::Eval => {
                let x = match ev(&node.value) {
                    Ok(x) => x,
                    Err(e) => return fail(e, k),
                };
                let name = if node.output.is_empty() {
                    "result"
                } else {
                    node.output.as_str()
                };
                Self::set_output(&run, node, Value::obj(vec![(name, x)]));
                k(Some("next"))
            }
            NKind::InRange => {
                let triple = (|| -> Result<(f64, f64, f64), EvalError> {
                    Ok((
                        v::num(&ev(&node.value)?),
                        v::num(&ev(&node.low)?),
                        v::num(&ev(&node.high)?),
                    ))
                })();
                let (x, lo, hi) = match triple {
                    Ok(t) => t,
                    Err(e) => return fail(e, k),
                };
                let result = if node.flag {
                    let key = format!("{}/{}", wf.id, node.id);
                    let mut h = self.hysteresis.borrow_mut();
                    let s = h.entry(key).or_insert(false);
                    if x >= hi {
                        *s = true;
                    } else if x <= lo {
                        *s = false;
                    }
                    *s
                } else {
                    lo <= x && x <= hi
                };
                Self::set_output(
                    &run,
                    node,
                    Value::obj(vec![
                        ("result", Value::Bool(result)),
                        ("state", Value::Bool(result)),
                    ]),
                );
                k(Some("next"))
            }
            NKind::Filter => {
                let x = match ev(&node.value) {
                    Ok(v) => v::num(&v),
                    Err(e) => return fail(e, k),
                };
                let key = format!("{}/{}", wf.id, node.id);
                let (y, samples) = {
                    let mut filters = self.filters.borrow_mut();
                    let f = filters.entry(key).or_default();
                    f.add(x, node.filter_mode, node.count, node.alpha)
                };
                Self::set_output(
                    &run,
                    node,
                    Value::obj(vec![
                        ("value", Value::Float(y)),
                        ("samples", Value::Int(samples as i128)),
                    ]),
                );
                k(Some("next"))
            }
            NKind::Log => {
                let message = match ev(&node.value) {
                    Ok(x) => text(&x),
                    Err(e) => return fail(e, k),
                };
                self.sink.log(
                    self.now(),
                    node.level.as_deref().unwrap_or("info"),
                    &message,
                );
                let mut d = vec![("kind", Value::str("log"))];
                if let Some(l) = &node.level {
                    d.push(("level", Value::str(l)));
                }
                d.push(("message", Value::str(&message)));
                self.trace_node("value", &run, node, Some(Value::obj(d)));
                k(Some("next"))
            }
            NKind::Publish => {
                let payload = match ev(&node.value) {
                    Ok(x) => text(&x),
                    Err(e) => return fail(e, k),
                };
                let topic = &node.topic.as_ref().unwrap().topic;
                self.trace_node(
                    "value",
                    &run,
                    node,
                    Some(Value::obj(vec![
                        ("kind", Value::str("mqtt")),
                        ("topic", Value::str(topic)),
                        ("payload", Value::str(&payload)),
                    ])),
                );
                self.pubsub.publish(topic, &payload);
                k(Some("next"))
            }
        }
    }

    fn repeat_step(&self, f: &Rc<Fiber>, node: &Rc<NodeDef>, i: i64, k: Cont) -> Flow {
        if !(i < node.count && !f.run.token.cancelled.get()) {
            return k(Some("next"));
        }
        let (rt, ff, nd) = (self.rc(), f.clone(), node.clone());
        let body: Cont = Box::new(move |_| {
            Inner::set_output(
                &ff.run,
                &nd,
                Value::obj(vec![("index", Value::Int(i as i128))]),
            );
            let (rt2, f2, n2) = (rt.clone(), ff.clone(), nd.clone());
            rt.chain(
                &ff,
                nd.body.clone(),
                Box::new(move || {
                    let (rt3, f3, n3) = (rt2.clone(), f2.clone(), n2.clone());
                    rt2.sleep(
                        &f2,
                        0,
                        Box::new(move |_| rt3.repeat_step(&f3, &n3, i + 1, k)),
                    );
                    Ok(())
                }),
            )
        });
        if i > 0 && node.ms > 0 {
            self.sleep(f, node.ms, body);
            Ok(())
        } else {
            body(None)
        }
    }

    fn while_step(&self, f: &Rc<Fiber>, node: &Rc<NodeDef>, i: i64, k: Cont) -> Flow {
        if f.run.token.cancelled.get() {
            return k(Some("next"));
        }
        let (rt, ff, nd) = (self.rc(), f.clone(), node.clone());
        let body: Cont = Box::new(move |_| {
            let r = ff.run.clone();
            let wf = Inner::wf_of(&r.trigger);
            let go = match &nd.condition {
                None => Ok(false),
                Some(c) => rt.eval(&wf, Some(&r), c).map(|x| x.is_true()),
            };
            let go = match go {
                Ok(g) => g,
                Err(e) => {
                    let h = rt.on_error(&r, &nd, e.reason, &e.message);
                    return k(h);
                }
            };
            if !go {
                return k(Some("next"));
            }
            if i >= nd.max_iterations {
                rt.trace_node(
                    "error",
                    &r,
                    &nd,
                    Some(Value::obj(vec![
                        ("reason", Value::str("loop_guard")),
                        ("maxIterations", Value::Int(nd.max_iterations as i128)),
                    ])),
                );
                r.token.cancel();
                let current = rt.current.borrow().clone();
                rt.reap(&r, current.as_ref());
                return Err(StopRun);
            }
            Inner::set_output(&r, &nd, Value::obj(vec![("index", Value::Int(i as i128))]));
            let (rt2, f2, n2) = (rt.clone(), ff.clone(), nd.clone());
            rt.chain(
                &ff,
                nd.body.clone(),
                Box::new(move || {
                    let (rt3, f3, n3) = (rt2.clone(), f2.clone(), n2.clone());
                    rt2.sleep(
                        &f2,
                        0,
                        Box::new(move |_| rt3.while_step(&f3, &n3, i + 1, k)),
                    );
                    Ok(())
                }),
            )
        });
        if i > 0 && node.ms > 0 {
            self.sleep(f, node.ms, body);
            Ok(())
        } else {
            body(None)
        }
    }
}

/// Handles are `&'static str`; `case_<i>` handles are made once per index.
fn leak(s: String) -> &'static str {
    thread_local! {
        static CASES: RefCell<HashMap<String, &'static str>> = RefCell::new(HashMap::new());
    }
    CASES.with(|c| {
        *c.borrow_mut()
            .entry(s.clone())
            .or_insert_with(|| Box::leak(s.into_boxed_str()))
    })
}
