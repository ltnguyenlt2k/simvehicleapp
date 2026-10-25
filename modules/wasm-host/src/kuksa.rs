//! The databroker over `kuksa.val.v2` (ADR-0047) for WebAssembly apps: JSON values of the ABI ⇄ v2 values, and the
//! calls the guest's requests turn into. Writes are `Actuate`, as for native v2 apps (the signal-gateway is the
//! actuators' provider in dev runs).

use kuksa_rust_sdk::v2_proto::{self as v2, signal_id::Signal, value::TypedValue};
use serde_json::Value;

/// A v2 value ⇒ the ABI's JSON (int64/uint64 as decimal strings, ADR-0018).
pub fn from_v2(x: &v2::Value) -> Option<Value> {
    let big = |i: i128| {
        if i.unsigned_abs() > (1u128 << 53) - 1 {
            Value::from(i.to_string())
        } else {
            Value::from(i as i64)
        }
    };
    Some(match x.typed_value.as_ref()? {
        TypedValue::String(s) => Value::from(s.clone()),
        TypedValue::Bool(b) => Value::from(*b),
        TypedValue::Int32(i) => Value::from(*i),
        TypedValue::Int64(i) => Value::from(i.to_string()),
        TypedValue::Uint32(i) => Value::from(*i),
        TypedValue::Uint64(i) => Value::from(i.to_string()),
        TypedValue::Float(f) => serde_json::Number::from_f64(*f as f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        TypedValue::Double(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        TypedValue::StringArray(a) => Value::from(a.values.clone()),
        TypedValue::BoolArray(a) => Value::from(a.values.clone()),
        TypedValue::Int32Array(a) => Value::from(a.values.clone()),
        TypedValue::Int64Array(a) => Value::Array(
            a.values
                .iter()
                .map(|i| Value::from(i.to_string()))
                .collect(),
        ),
        TypedValue::Uint32Array(a) => Value::from(a.values.clone()),
        TypedValue::Uint64Array(a) => {
            Value::Array(a.values.iter().map(|i| big(*i as i128)).collect())
        }
        TypedValue::FloatArray(a) => Value::Array(
            a.values
                .iter()
                .filter_map(|f| serde_json::Number::from_f64(*f as f64).map(Value::Number))
                .collect(),
        ),
        TypedValue::DoubleArray(a) => Value::Array(
            a.values
                .iter()
                .filter_map(|f| serde_json::Number::from_f64(*f).map(Value::Number))
                .collect(),
        ),
    })
}

fn int(x: &Value) -> Option<i128> {
    match x {
        Value::Number(n) => n
            .as_i64()
            .map(i128::from)
            .or_else(|| n.as_u64().map(i128::from)),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// The ABI's JSON value of VSS type `ty` ⇒ a v2 value to write. Arrays are read-only (ADR-0018): refused.
pub fn to_v2(ty: &str, x: &Value) -> Result<v2::Value, String> {
    let bad = || format!("{x} is not a {ty}");
    let typed = match ty {
        "boolean" => TypedValue::Bool(x.as_bool().ok_or_else(bad)?),
        "string" => TypedValue::String(x.as_str().ok_or_else(bad)?.to_string()),
        "float" => TypedValue::Float(x.as_f64().ok_or_else(bad)? as f32),
        "double" => TypedValue::Double(x.as_f64().ok_or_else(bad)?),
        "int8" => TypedValue::Int32(
            int(x)
                .and_then(|i| i8::try_from(i).ok())
                .ok_or_else(bad)?
                .into(),
        ),
        "int16" => TypedValue::Int32(
            int(x)
                .and_then(|i| i16::try_from(i).ok())
                .ok_or_else(bad)?
                .into(),
        ),
        "int32" => TypedValue::Int32(int(x).and_then(|i| i32::try_from(i).ok()).ok_or_else(bad)?),
        "int64" => TypedValue::Int64(int(x).and_then(|i| i64::try_from(i).ok()).ok_or_else(bad)?),
        "uint8" => TypedValue::Uint32(
            int(x)
                .and_then(|i| u8::try_from(i).ok())
                .ok_or_else(bad)?
                .into(),
        ),
        "uint16" => TypedValue::Uint32(
            int(x)
                .and_then(|i| u16::try_from(i).ok())
                .ok_or_else(bad)?
                .into(),
        ),
        "uint32" => TypedValue::Uint32(int(x).and_then(|i| u32::try_from(i).ok()).ok_or_else(bad)?),
        "uint64" => TypedValue::Uint64(int(x).and_then(|i| u64::try_from(i).ok()).ok_or_else(bad)?),
        _ => return Err(format!("cannot write a value of type {ty}")),
    };
    Ok(v2::Value {
        typed_value: Some(typed),
    })
}

pub fn signal(path: &str) -> Option<v2::SignalId> {
    Some(v2::SignalId {
        signal: Some(Signal::Path(path.to_string())),
    })
}

/// `grpc://host:port` or `host:port` ⇒ the URI tonic connects to.
pub fn http_uri(address: &str) -> String {
    let rest = address.split_once("://").map(|(_, r)| r).unwrap_or(address);
    format!("http://{rest}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_both_ways() {
        assert_eq!(
            to_v2("uint8", &Value::from(7)).unwrap().typed_value,
            Some(TypedValue::Uint32(7))
        );
        assert_eq!(
            to_v2("int64", &Value::from("9007199254740993"))
                .unwrap()
                .typed_value,
            Some(TypedValue::Int64(9007199254740993))
        );
        assert_eq!(
            to_v2("boolean", &Value::from(true)).unwrap().typed_value,
            Some(TypedValue::Bool(true))
        );
        assert!(to_v2("uint8", &Value::from(300)).is_err());
        assert!(to_v2("float", &Value::from("fast")).is_err());
        assert!(to_v2("string[]", &serde_json::json!(["a"])).is_err());
        assert_eq!(
            from_v2(&v2::Value {
                typed_value: Some(TypedValue::Float(130.0))
            }),
            Some(serde_json::json!(130.0))
        );
        assert_eq!(
            from_v2(&v2::Value {
                typed_value: Some(TypedValue::Int64(-3))
            }),
            Some(Value::from("-3"))
        );
        assert_eq!(from_v2(&v2::Value { typed_value: None }), None);
        assert_eq!(
            http_uri("grpc://databroker:55555"),
            "http://databroker:55555"
        );
        assert_eq!(http_uri("127.0.0.1:55555"), "http://127.0.0.1:55555");
    }
}
