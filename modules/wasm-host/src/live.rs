//! Running a WebAssembly app on the vehicle stack (M20-T03b): the guest's requests become `kuksa.val.v2` calls and
//! MQTT operations on tokio tasks, their answers come back as ABI events, and the loop delivers them, steps the guest
//! when it is due, and stops it on SIGTERM/SIGINT. Same environment as a native app: `SDV_VEHICLEDATABROKER_ADDRESS`,
//! `SDV_MQTT_ADDRESS`, `SV_TRACE_LEVEL`.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use anyhow::{bail, Result};
use kuksa_rust_sdk::v2_proto::{self as v2, val_client::ValClient};
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tonic::transport::{Channel, Endpoint};

use crate::abi::{self, Host, Line};
use crate::kuksa::{from_v2, http_uri, signal, to_v2};
use crate::vehicle::{Request, Vehicle};

/// How long the app waits for the first value of each signal before it starts anyway (as the native host).
const READY: Duration = Duration::from_secs(2);
const RETRY: Duration = Duration::from_millis(2500);

/// MQTT topic filter match (`+` one level, `#` the rest).
pub fn topic_matches(filter: &str, topic: &str) -> bool {
    let (mut f, mut t) = (filter.split('/'), topic.split('/'));
    loop {
        match (f.next(), t.next()) {
            (Some("#"), _) => return true,
            (Some("+"), Some(_)) => {}
            (Some(a), Some(b)) if a == b => {}
            (None, None) => return true,
            _ => return false,
        }
    }
}

struct LiveVehicle {
    val: ValClient<Channel>,
    mqtt: AsyncClient,
    filters: Rc<RefCell<Vec<(i32, String)>>>,
    events: mpsc::UnboundedSender<String>,
    /// Subscriptions waiting for their first answer (the app starts when none is left, or after [`READY`]).
    pending: Rc<Cell<usize>>,
}

impl Vehicle for LiveVehicle {
    fn execute(&mut self, request: Request) -> Vec<String> {
        let tx = self.events.clone();
        match request {
            Request::Subscribe { sub, path, .. } => {
                let (mut val, pending) = (self.val.clone(), self.pending.clone());
                pending.set(pending.get() + 1);
                tokio::task::spawn_local(async move {
                    let mut first = true;
                    loop {
                        match val
                            .subscribe(v2::SubscribeRequest {
                                signal_paths: vec![path.clone()],
                                ..Default::default()
                            })
                            .await
                        {
                            Ok(stream) => {
                                let mut stream = stream.into_inner();
                                while let Ok(Some(reply)) = stream.message().await {
                                    let value = reply
                                        .entries
                                        .get(&path)
                                        .and_then(|d| d.value.as_ref())
                                        .and_then(from_v2)
                                        .unwrap_or(Value::Null);
                                    let initial = std::mem::take(&mut first);
                                    if initial {
                                        pending.set(pending.get() - 1);
                                    }
                                    let mut e = json!({"kind": "signal", "sub": sub, "path": path, "value": value, "ts": abi::epoch_ms()});
                                    if initial {
                                        e["initial"] = Value::from(true);
                                    }
                                    let _ = tx.send(e.to_string());
                                }
                                eprintln!("sv-wasm-host: subscription to {path} lost, retrying");
                            }
                            Err(e) => {
                                if std::mem::take(&mut first) {
                                    pending.set(pending.get() - 1);
                                }
                                if matches!(
                                    e.code(),
                                    tonic::Code::InvalidArgument | tonic::Code::NotFound
                                ) {
                                    eprintln!(
                                        "sv-wasm-host: subscription to {path} failed: {}",
                                        e.message()
                                    );
                                    return;
                                }
                            }
                        }
                        tokio::time::sleep(RETRY).await;
                    }
                });
            }
            Request::Get { req, path, .. } => {
                let mut val = self.val.clone();
                tokio::task::spawn_local(async move {
                    let r = val
                        .get_value(v2::GetValueRequest {
                            signal_id: signal(&path),
                        })
                        .await;
                    let (value, error) = match r {
                        Ok(r) => (
                            r.into_inner()
                                .data_point
                                .and_then(|d| d.value)
                                .as_ref()
                                .and_then(from_v2)
                                .unwrap_or(Value::Null),
                            String::new(),
                        ),
                        Err(e) => (Value::Null, format!("unavailable: {}", e.message())),
                    };
                    let _ = tx.send(
                        json!({"kind": "get_result", "req": req, "value": value, "error": error})
                            .to_string(),
                    );
                });
            }
            Request::Set {
                req,
                path,
                ty,
                value,
            } => {
                let mut val = self.val.clone();
                tokio::task::spawn_local(async move {
                    let error = match serde_json::from_str::<Value>(&value)
                        .map_err(|e| e.to_string())
                        .and_then(|x| to_v2(&ty, &x))
                    {
                        Err(e) => format!("type: {e}"),
                        Ok(x) => match val
                            .actuate(v2::ActuateRequest {
                                signal_id: signal(&path),
                                value: Some(x),
                            })
                            .await
                        {
                            Ok(_) => String::new(),
                            Err(e) => format!("rejected: {:?}: {}", e.code(), e.message()),
                        },
                    };
                    let _ = tx.send(
                        json!({"kind": "set_result", "req": req, "error": error}).to_string(),
                    );
                });
            }
            Request::MqttSubscribe { sub, filter } => {
                self.filters.borrow_mut().push((sub, filter.clone()));
                let mqtt = self.mqtt.clone();
                tokio::task::spawn_local(async move {
                    if let Err(e) = mqtt.subscribe(filter, QoS::AtMostOnce).await {
                        eprintln!("sv-wasm-host: MQTT subscribe: {e}");
                    }
                });
            }
            Request::MqttPublish { topic, payload } => {
                let mqtt = self.mqtt.clone();
                tokio::task::spawn_local(async move {
                    if let Err(e) = mqtt.publish(topic, QoS::AtMostOnce, false, payload).await {
                        eprintln!("sv-wasm-host: MQTT publish: {e}");
                    }
                });
            }
        }
        vec![]
    }
}

fn print(lines: Vec<Line>) {
    for l in lines {
        match l {
            Line::Out(t) => println!("{t}"),
            Line::Err(t) => eprintln!("{t}"),
        }
    }
}

fn lifecycle(app: &str, ev: &str) {
    if let Some(line) = abi::trace_line(app, abi::epoch_ms(), &json!({"ev": ev}).to_string()) {
        println!("{line}");
    }
}

fn mqtt_options(app: &str, address: &str) -> MqttOptions {
    let rest = address.split_once("://").map(|(_, r)| r).unwrap_or(address);
    let (host, port) = rest
        .rsplit_once(':')
        .map(|(h, p)| (h.to_string(), p.parse().unwrap_or(1883)))
        .unwrap_or((rest.to_string(), 1883));
    let mut o = MqttOptions::new(format!("{app}-{}", std::process::id()), host, port);
    o.set_keep_alive(Duration::from_secs(30));
    o
}

/// Runs the app until SIGTERM/SIGINT. Call inside a tokio `LocalSet`.
pub async fn run(mut host: Host) -> Result<()> {
    let vdb = std::env::var("SDV_VEHICLEDATABROKER_ADDRESS")
        .unwrap_or_else(|_| "grpc://127.0.0.1:55555".into());
    let mqtt_address =
        std::env::var("SDV_MQTT_ADDRESS").unwrap_or_else(|_| "mqtt://127.0.0.1:1883".into());
    if let Ok(api) = std::env::var("SV_DATABROKER_API") {
        if api != "kuksa.val.v2" && !api.ends_with("=kuksa.val.v2") {
            bail!("a WebAssembly app speaks kuksa.val.v2 only (SV_DATABROKER_API={api})");
        }
    }
    let app = host.app().to_string();
    eprintln!("sv-wasm-host: {app} on databroker {vdb} over kuksa.val.v2");
    let channel = Endpoint::from_shared(http_uri(&vdb))?.connect_lazy();
    let (mqtt, mut eventloop) = AsyncClient::new(mqtt_options(&app, &mqtt_address), 64);
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let filters: Rc<RefCell<Vec<(i32, String)>>> = Rc::default();
    {
        let (tx, filters) = (tx.clone(), filters.clone());
        tokio::task::spawn_local(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::Publish(p))) => {
                        let payload = String::from_utf8_lossy(&p.payload).to_string();
                        for (sub, f) in filters.borrow().iter() {
                            if topic_matches(f, &p.topic) {
                                let _ = tx.send(json!({"kind": "mqtt", "sub": sub, "topic": p.topic, "payload": payload}).to_string());
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("sv-wasm-host: MQTT connection: {e}");
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        });
    }
    let pending = Rc::new(Cell::new(0));
    let mut car = LiveVehicle {
        val: ValClient::new(channel),
        mqtt: mqtt.clone(),
        filters,
        events: tx,
        pending: pending.clone(),
    };

    let level = std::env::var("SV_TRACE_LEVEL").unwrap_or_else(|_| "node".into());
    let code = host.init(&json!({"app": app, "traceLevel": level}).to_string())?;
    print(host.take_lines());
    if code != 0 {
        bail!("the app did not start (sv_init returned {code})");
    }
    let mut due = abi::pump(&mut host, &mut car)?;
    print(host.take_lines());
    // First values (baselines) before the app counts as started, at most READY.
    let start = tokio::time::Instant::now();
    while pending.get() > 0 && start.elapsed() < READY {
        if let Ok(Some(e)) = tokio::time::timeout(Duration::from_millis(20), rx.recv()).await {
            host.deliver(&e)?;
            due = abi::pump(&mut host, &mut car)?;
            print(host.take_lines());
        }
    }
    if pending.get() > 0 {
        eprintln!("sv-wasm-host: some subscriptions are not open after {READY:?}, starting anyway");
    }
    lifecycle(&app, "vdb.connected");
    lifecycle(&app, "app.started");

    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    loop {
        let wait = if due < 0 {
            Duration::from_secs(3600)
        } else {
            Duration::from_millis((due - host.now_ms()).max(0) as u64)
        };
        tokio::select! {
            e = rx.recv() => match e {
                Some(e) => {
                    host.deliver(&e)?;
                    due = abi::pump(&mut host, &mut car)?;
                }
                None => break,
            },
            _ = tokio::time::sleep(wait) => {
                due = abi::pump(&mut host, &mut car)?;
            }
            _ = tokio::signal::ctrl_c() => break,
            _ = term.recv() => break,
        }
        print(host.take_lines());
    }
    host.stop()?;
    print(host.take_lines());
    let _ = mqtt.disconnect().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::topic_matches;

    #[test]
    fn mqtt_filters() {
        assert!(topic_matches("app/#", "app/hmi/x"));
        assert!(topic_matches("app/+/x", "app/hmi/x"));
        assert!(!topic_matches("app/+", "app/hmi/x"));
        assert!(topic_matches("app/hmi", "app/hmi"));
        assert!(!topic_matches("app/hmi", "app/other"));
    }
}
