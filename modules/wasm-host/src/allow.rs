//! Allowlist of a WebAssembly app (`sv-app.json`, generated next to `app.wasm`): the signals it may read and write
//! and its MQTT topics. Anything else is refused by the host (`forbidden`, ABI §5).

use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub struct Allowlist {
    pub app: String,
    read: Vec<String>,
    write: Vec<String>,
    topics: Vec<String>,
    /// No `sv-app.json`: everything allowed (tests, `--test` mode).
    open: bool,
}

impl Allowlist {
    pub fn open(app: &str) -> Self {
        Allowlist {
            app: app.into(),
            open: true,
            ..Default::default()
        }
    }

    /// `{"app": "Overspeed", "signals": {"read": [...], "write": [...]}, "topics": [...]}`
    pub fn parse(text: &str) -> anyhow::Result<Self> {
        let v: Value = serde_json::from_str(text)?;
        let list = |x: Option<&Value>| -> Vec<String> {
            x.and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        let app = v
            .get("app")
            .and_then(Value::as_str)
            .unwrap_or("app")
            .to_string();
        let signals = v.get("signals");
        Ok(Allowlist {
            app,
            read: list(signals.and_then(|s| s.get("read"))),
            write: list(signals.and_then(|s| s.get("write"))),
            topics: list(v.get("topics")),
            open: false,
        })
    }

    /// A path the app reads (or writes: an app reads back what it writes).
    pub fn reads(&self, path: &str) -> bool {
        self.open || self.read.iter().any(|p| p == path) || self.write.iter().any(|p| p == path)
    }

    pub fn writes(&self, path: &str) -> bool {
        self.open || self.write.iter().any(|p| p == path)
    }

    /// A topic the app publishes or subscribes to: listed exactly, or under a listed prefix ending in `/`.
    pub fn topic(&self, topic: &str) -> bool {
        self.open
            || self
                .topics
                .iter()
                .any(|t| t == topic || (t.ends_with('/') && topic.starts_with(t.as_str())))
    }
}
