//! The runtime as a vehicle app (feature `host`, ADR-0041): `sdv.databroker.v1` through `kuksa-rust-sdk` 0.2.2
//! (its generated broker stubs on one tonic channel) and MQTT through `rumqttc`, on a tokio current-thread
//! runtime — one thread, one strand. Environment as Velocitas apps: `SDV_VEHICLEDATABROKER_ADDRESS`,
//! `SDV_MQTT_ADDRESS`, `SV_TRACE_LEVEL`.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::time::Duration;

use kuksa_rust_sdk::sdv_proto::{
    self as proto, broker_client::BrokerClient, datapoint::Value as Dp, Datapoint,
};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use tonic::transport::{Channel, Endpoint};

use crate::runtime::{MqttHandler, PubSub, Runtime, StdoutTraceSink, VehicleAccess};
use crate::strand::Strand;
use crate::values::{self as v, Value};

/// SDK value ⇒ JSON-shaped value; `None` when the broker has no valid value.
pub fn from_sdk(dp: &Datapoint) -> Option<Value> {
    Some(match dp.value.as_ref()? {
        Dp::FailureValue(_) => return None,
        Dp::StringValue(s) => Value::Str(s.clone()),
        Dp::BoolValue(b) => Value::Bool(*b),
        Dp::Int32Value(i) => Value::Int(*i as i128),
        Dp::Int64Value(i) => Value::Int(*i as i128),
        Dp::Uint32Value(i) => Value::Int(*i as i128),
        Dp::Uint64Value(i) => Value::Int(*i as i128),
        Dp::FloatValue(f) => Value::Float(*f as f64),
        Dp::DoubleValue(f) => Value::Float(*f),
        Dp::StringArray(a) => {
            Value::Array(a.values.iter().map(|s| Value::Str(s.clone())).collect())
        }
        Dp::BoolArray(a) => Value::Array(a.values.iter().map(|b| Value::Bool(*b)).collect()),
        Dp::Int32Array(a) => {
            Value::Array(a.values.iter().map(|i| Value::Int(*i as i128)).collect())
        }
        Dp::Int64Array(a) => {
            Value::Array(a.values.iter().map(|i| Value::Int(*i as i128)).collect())
        }
        Dp::Uint32Array(a) => {
            Value::Array(a.values.iter().map(|i| Value::Int(*i as i128)).collect())
        }
        Dp::Uint64Array(a) => {
            Value::Array(a.values.iter().map(|i| Value::Int(*i as i128)).collect())
        }
        Dp::FloatArray(a) => {
            Value::Array(a.values.iter().map(|f| Value::Float(*f as f64)).collect())
        }
        Dp::DoubleArray(a) => Value::Array(a.values.iter().map(|f| Value::Float(*f)).collect()),
    })
}

/// Runtime value of VSS type `ty` ⇒ Datapoint to set (actuators are never arrays, ADR-0018); uint8/uint16 are
/// sent as uint32, the databroker's wire type for them on sdv.databroker.v1 (same as the C++/Python hosts).
pub fn to_sdk(ty: &str, x: &Value) -> Result<Datapoint, String> {
    let i = || v::big(x).unwrap_or(0);
    let value = match ty {
        "boolean" => Dp::BoolValue(x.is_true()),
        "int8" | "int16" | "int32" => Dp::Int32Value(i() as i32),
        "int64" => Dp::Int64Value(i() as i64),
        "uint8" | "uint16" | "uint32" => Dp::Uint32Value(i() as u32),
        "uint64" => Dp::Uint64Value(i() as u64),
        "float" => Dp::FloatValue(v::num(x) as f32),
        "double" => Dp::DoubleValue(v::num(x)),
        "string" => Dp::StringValue(v::js_string(x)),
        other => {
            return Err(format!(
                "simvehicleapp runtime: cannot write a value of type {other}"
            ))
        }
    };
    Ok(Datapoint {
        timestamp: None,
        value: Some(value),
    })
}

fn http_uri(address: &str) -> String {
    let rest = address.split_once("://").map(|(_, r)| r).unwrap_or(address);
    format!("http://{rest}")
}

struct Vdb {
    broker: BrokerClient<Channel>,
    strand: Rc<Strand>,
    baselines: RefCell<HashMap<String, Value>>,
    pending: Rc<Cell<usize>>,
}

impl Vdb {
    async fn prefetch(&self, paths: &BTreeMap<String, String>) {
        for (path, ty) in paths {
            let mut broker = self.broker.clone();
            match broker
                .get_datapoints(proto::GetDatapointsRequest {
                    datapoints: vec![path.clone()],
                })
                .await
            {
                Ok(reply) => {
                    if let Some(x) = reply.into_inner().datapoints.get(path).and_then(from_sdk) {
                        self.baselines
                            .borrow_mut()
                            .insert(path.clone(), v::from_json(&x, ty));
                    }
                }
                Err(e) => eprintln!("simvehicleapp: no current value of {path}: {}", e.message()),
            }
        }
    }

    /// Waits until every subscription delivered its first reply (or failed), at most `limit` (ADR-0040 Notes §10).
    async fn ready(&self, limit: Duration) {
        let start = std::time::Instant::now();
        while self.pending.get() > 0 && start.elapsed() < limit {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        if self.pending.get() > 0 {
            eprintln!(
                "simvehicleapp: some subscriptions are not open after {limit:?}, starting anyway"
            );
        }
    }
}

impl VehicleAccess for Vdb {
    fn current(&self, path: &str, _ty: &str) -> Option<Value> {
        self.baselines.borrow().get(path).cloned()
    }

    fn subscribe(&self, path: &str, ty: &str, on_value: Box<dyn Fn(Value)>) {
        let (mut broker, strand, path, ty, on_value, pending) = (
            self.broker.clone(),
            self.strand.clone(),
            path.to_string(),
            ty.to_string(),
            Rc::new(on_value),
            self.pending.clone(),
        );
        pending.set(pending.get() + 1);
        tokio::task::spawn_local(async move {
            let mut first = true;
            let opened = |first: &mut bool| {
                if std::mem::take(first) {
                    pending.set(pending.get() - 1);
                }
            };
            loop {
                match broker
                    .subscribe(proto::SubscribeRequest {
                        query: format!("SELECT {path}"),
                    })
                    .await
                {
                    Ok(stream) => {
                        let mut stream = stream.into_inner();
                        loop {
                            match stream.message().await {
                                Ok(Some(reply)) => {
                                    opened(&mut first);
                                    if let Some(x) = reply.fields.get(&path).and_then(from_sdk) {
                                        let (cb, x) = (on_value.clone(), v::from_json(&x, &ty));
                                        strand.post(move || cb(x));
                                    }
                                }
                                Ok(None) => break,
                                Err(e) => {
                                    eprintln!(
                                        "simvehicleapp: subscription to {path} lost ({}), retrying",
                                        e.message()
                                    );
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        opened(&mut first);
                        if e.code() == tonic::Code::InvalidArgument {
                            eprintln!(
                                "simvehicleapp: subscription to {path} failed: {}",
                                e.message()
                            );
                            return;
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(2500)).await;
            }
        });
    }

    fn get(&self, path: &str, ty: &str, done: Box<dyn FnOnce(Option<Value>, String)>) {
        let (mut broker, strand, path, ty) = (
            self.broker.clone(),
            self.strand.clone(),
            path.to_string(),
            ty.to_string(),
        );
        tokio::task::spawn_local(async move {
            let (x, err) = match broker
                .get_datapoints(proto::GetDatapointsRequest {
                    datapoints: vec![path.clone()],
                })
                .await
            {
                Ok(reply) => (
                    reply
                        .into_inner()
                        .datapoints
                        .get(&path)
                        .and_then(from_sdk)
                        .map(|x| v::from_json(&x, &ty)),
                    String::new(),
                ),
                Err(e) => (None, e.message().to_string()),
            };
            strand.post(move || done(x, if err.is_empty() { String::new() } else { err }));
        });
    }

    fn set(&self, path: &str, ty: &str, value: Value, done: Option<Box<dyn FnOnce(String)>>) {
        let (mut broker, strand, path) =
            (self.broker.clone(), self.strand.clone(), path.to_string());
        let dp = to_sdk(ty, &value);
        tokio::task::spawn_local(async move {
            let err = match dp {
                Err(e) => e,
                Ok(dp) => match broker
                    .set_datapoints(proto::SetDatapointsRequest {
                        datapoints: HashMap::from([(path.clone(), dp)]),
                    })
                    .await
                {
                    Ok(reply) => {
                        let errors = reply.into_inner().errors;
                        match errors.get(&path).or_else(|| errors.values().next()) {
                            Some(code) => proto::DatapointError::try_from(*code)
                                .map(|e| e.as_str_name().to_string())
                                .unwrap_or_else(|_| format!("error {code}")),
                            None => String::new(),
                        }
                    }
                    Err(e) => e.message().to_string(),
                },
            };
            if !err.is_empty() {
                eprintln!("simvehicleapp: set {path} failed: {err}");
            }
            if let Some(done) = done {
                strand.post(move || done(err));
            }
        });
    }
}

struct Mqtt {
    client: AsyncClient,
    handler: Rc<RefCell<Option<MqttHandler>>>,
}

impl PubSub for Mqtt {
    fn set_handler(&self, handler: MqttHandler) {
        *self.handler.borrow_mut() = Some(handler);
    }
    fn subscribe(&self, filter: &str) {
        let (client, filter) = (self.client.clone(), filter.to_string());
        tokio::task::spawn_local(async move {
            if let Err(e) = client.subscribe(filter.clone(), QoS::AtMostOnce).await {
                eprintln!("simvehicleapp: MQTT subscription {filter} failed: {e}");
            }
        });
    }
    fn publish(&self, topic: &str, payload: &str) {
        let (client, topic, payload) =
            (self.client.clone(), topic.to_string(), payload.to_string());
        tokio::task::spawn_local(async move {
            let _ = client.publish(topic, QoS::AtMostOnce, false, payload).await;
        });
    }
}

/// A generated app: its name, the `bind` of every workflow, the generated trace level and the user hooks.
pub struct App {
    pub name: &'static str,
    pub workflows: &'static [fn(&Runtime)],
    pub trace_level: &'static str,
    pub on_app_start: fn(),
    pub on_app_stop: fn(),
}

/// Runs the app until SIGTERM/SIGINT or a Stop block with scope "app". Call inside a `LocalSet`.
pub async fn run(app: App) -> Result<(), String> {
    let vdb_address = std::env::var("SDV_VEHICLEDATABROKER_ADDRESS")
        .unwrap_or_else(|_| "grpc://127.0.0.1:55555".into());
    let mqtt_address =
        std::env::var("SDV_MQTT_ADDRESS").unwrap_or_else(|_| "mqtt://127.0.0.1:1883".into());
    let channel = Endpoint::from_shared(http_uri(&vdb_address))
        .map_err(|e| e.to_string())?
        .connect_lazy();

    let strand = Rc::new(Strand::new_monotonic());
    let vdb = Rc::new(Vdb {
        broker: BrokerClient::new(channel),
        strand: strand.clone(),
        baselines: RefCell::new(HashMap::new()),
        pending: Rc::new(Cell::new(0)),
    });

    let rest = mqtt_address
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(&mqtt_address);
    let (host, port) = rest
        .rsplit_once(':')
        .map(|(h, p)| (h.to_string(), p.parse().unwrap_or(1883)))
        .unwrap_or((rest.to_string(), 1883));
    let mut options = MqttOptions::new(format!("{}-{}", app.name, std::process::id()), host, port);
    options.set_keep_alive(Duration::from_secs(30));
    let (client, mut eventloop) = AsyncClient::new(options, 64);
    let handler: Rc<RefCell<Option<MqttHandler>>> = Rc::new(RefCell::new(None));
    let mqtt = Rc::new(Mqtt {
        client: client.clone(),
        handler: handler.clone(),
    });
    {
        let (strand, handler) = (strand.clone(), handler.clone());
        tokio::task::spawn_local(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        let (topic, payload) = (
                            p.topic.clone(),
                            String::from_utf8_lossy(&p.payload).to_string(),
                        );
                        let h = handler.borrow().clone();
                        if let Some(h) = h {
                            strand.post(move || h(&topic, &payload, None));
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("simvehicleapp: MQTT connection: {e}");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }

    let level = StdoutTraceSink::level_from_env(app.trace_level);
    let runtime = Runtime::new(
        strand.clone(),
        vdb.clone(),
        mqtt.clone(),
        Rc::new(StdoutTraceSink::new(app.name, &level)),
    );
    for bind in app.workflows {
        bind(&runtime);
    }
    vdb.prefetch(&runtime.signals()).await;
    runtime.trace_lifecycle("vdb.connected");
    (app.on_app_start)();
    runtime.start();
    vdb.ready(Duration::from_secs(2)).await;
    runtime.trace_lifecycle("app.started");

    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|e| e.to_string())?;
    tokio::select! {
        _ = strand.run() => {}
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    runtime.trace_lifecycle("app.stopping");
    (app.on_app_stop)();
    runtime.stop_all();
    strand.stop();
    let _ = client.disconnect().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversions() {
        assert_eq!(
            from_sdk(&Datapoint {
                timestamp: None,
                value: Some(Dp::FloatValue(0.1))
            }),
            Some(Value::Float(0.1f32 as f64))
        );
        assert_eq!(
            from_sdk(&Datapoint {
                timestamp: None,
                value: Some(Dp::FailureValue(1))
            }),
            None
        );
        assert_eq!(
            from_sdk(&Datapoint {
                timestamp: None,
                value: None
            }),
            None
        );
        assert_eq!(
            to_sdk("uint8", &Value::Int(7)).unwrap().value,
            Some(Dp::Uint32Value(7))
        );
        assert_eq!(
            to_sdk("int16", &Value::Int(-3)).unwrap().value,
            Some(Dp::Int32Value(-3))
        );
        assert!(to_sdk("uint8[]", &Value::Array(vec![])).is_err());
        assert_eq!(
            http_uri("grpc://databroker:55555"),
            "http://databroker:55555"
        );
    }
}
