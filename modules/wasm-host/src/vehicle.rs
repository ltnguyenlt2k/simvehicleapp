//! The vehicle as the host sees it: what an app's `vdb_*` and `mqtt_*` requests turn into. The databroker
//! (`kuksa.val.v2`) and MQTT implementations come with M20-T03b; [`MockVehicle`] serves tests and `--test`.

use std::collections::BTreeMap;

/// What the guest asked for, executed by the host outside the guest call (no re-entry, ABI §5).
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    Subscribe {
        sub: i32,
        path: String,
        ty: String,
    },
    Get {
        req: i32,
        path: String,
        ty: String,
    },
    Set {
        req: i32,
        path: String,
        ty: String,
        value: String,
    },
    MqttSubscribe {
        sub: i32,
        filter: String,
    },
    MqttPublish {
        topic: String,
        payload: String,
    },
}

/// A vehicle: executes requests and answers with events (ABI §4.1, as JSON text).
pub trait Vehicle {
    fn execute(&mut self, request: Request) -> Vec<String>;
}

/// In-memory vehicle: values by path, subscriptions answered on change; MQTT publishes kept.
#[derive(Default)]
pub struct MockVehicle {
    pub values: BTreeMap<String, String>,
    subs: Vec<(i32, String)>,
    pub published: Vec<(String, String)>,
}

impl MockVehicle {
    /// A value set from outside (a test feeding a sensor): `signal` events for its subscriptions.
    pub fn feed(&mut self, path: &str, value_json: &str) -> Vec<String> {
        self.values.insert(path.into(), value_json.into());
        self.subs
            .iter()
            .filter(|(_, p)| p == path)
            .map(|(sub, p)| {
                format!(
                    r#"{{"kind":"signal","sub":{sub},"path":{},"value":{value_json}}}"#,
                    serde_json::Value::from(p.as_str())
                )
            })
            .collect()
    }
}

impl Vehicle for MockVehicle {
    fn execute(&mut self, request: Request) -> Vec<String> {
        match request {
            Request::Subscribe { sub, path, .. } => {
                self.subs.push((sub, path));
                vec![]
            }
            Request::Get { req, path, .. } => {
                let value = self
                    .values
                    .get(&path)
                    .cloned()
                    .unwrap_or_else(|| "null".into());
                vec![format!(
                    r#"{{"kind":"get_result","req":{req},"value":{value},"error":""}}"#
                )]
            }
            Request::Set {
                req, path, value, ..
            } => {
                let mut out = vec![format!(r#"{{"kind":"set_result","req":{req},"error":""}}"#)];
                out.extend(self.feed(&path, &value));
                out
            }
            Request::MqttSubscribe { .. } => vec![],
            Request::MqttPublish { topic, payload } => {
                self.published.push((topic, payload));
                vec![]
            }
        }
    }
}
