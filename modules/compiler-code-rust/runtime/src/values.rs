//! Runtime values and expression helpers (IR_SPEC "Semantics every backend implements", ADR-0041).
//!
//! A port of the reference simulator's `values.ts` (through the Python runtime's `values.py`): integer-typed
//! values are exact `i128` (int64 and uint64 both fit), floats are `f64` and `float` (binary32) results are
//! rounded with [`fround`]. Every helper reproduces the JavaScript arithmetic the simulator uses (division by
//! zero gives ±Infinity/NaN, `%` is `fmod`, rounding is half away from zero), so a generated Rust app and the
//! simulator agree on every value — the parity tests (P1, P3) check it.

use std::fmt::Write as _;

/// A runtime value (the JSON data model plus exact integers).
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i128),
    Float(f64),
    Str(String),
    Array(Vec<Value>),
    /// Keys in insertion order (trace data is compared as JSON text).
    Object(Vec<(String, Value)>),
}

/// A missing value or an index out of range: the node's `error` branch / `onError` (ADR-0017 Notes).
#[derive(Clone, Debug, PartialEq)]
pub struct EvalError {
    pub reason: &'static str,
    pub message: String,
}

impl EvalError {
    pub fn new(reason: &'static str, message: impl Into<String>) -> Self {
        EvalError {
            reason,
            message: message.into(),
        }
    }
}

pub type R = Result<Value, EvalError>;

impl Value {
    pub fn str(s: impl Into<String>) -> Value {
        Value::Str(s.into())
    }
    pub fn obj(entries: Vec<(&str, Value)>) -> Value {
        Value::Object(
            entries
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        )
    }
    pub fn is_true(&self) -> bool {
        matches!(self, Value::Bool(true))
    }
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(o) => o.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn set(&mut self, key: &str, value: Value) {
        if let Value::Object(o) = self {
            if let Some(e) = o.iter_mut().find(|(k, _)| k == key) {
                e.1 = value;
            } else {
                o.push((key.to_string(), value));
            }
        }
    }
}

pub fn int_bounds(t: &str) -> Option<(i128, i128)> {
    Some(match t {
        "int8" => (-(1 << 7), (1 << 7) - 1),
        "int16" => (-(1 << 15), (1 << 15) - 1),
        "int32" => (-(1i128 << 31), (1i128 << 31) - 1),
        "int64" => (-(1i128 << 63), (1i128 << 63) - 1),
        "uint8" => (0, (1 << 8) - 1),
        "uint16" => (0, (1 << 16) - 1),
        "uint32" => (0, (1i128 << 32) - 1),
        "uint64" => (0, (1i128 << 64) - 1),
        _ => return None,
    })
}

pub const MAX_SAFE: i128 = (1i128 << 53) - 1;

pub fn is_int_type(t: &str) -> bool {
    int_bounds(t).is_some()
}

pub fn is_int_like(t: &str) -> bool {
    is_int_type(t) || t == "duration" || t == "timestamp"
}

pub fn is_number(v: &Value) -> bool {
    matches!(v, Value::Int(_) | Value::Float(_))
}

/// `Math.fround`: the nearest binary32.
pub fn fround(x: f64) -> f64 {
    x as f32 as f64
}

/// `Number(v)`.
pub fn js_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Int(i) => *i as f64,
        Value::Float(f) => *f,
        Value::Str(s) => {
            let s = s.trim();
            if s.is_empty() {
                return 0.0;
            }
            let lower = s.to_ascii_lowercase();
            if let Some(hex) = lower.strip_prefix("0x") {
                return i128::from_str_radix(hex, 16)
                    .map(|i| i as f64)
                    .unwrap_or(f64::NAN);
            }
            match s {
                "Infinity" | "+Infinity" => return f64::INFINITY,
                "-Infinity" => return f64::NEG_INFINITY,
                _ => {}
            }
            if s.chars().any(|c| c.is_alphabetic() && c != 'e' && c != 'E') {
                return f64::NAN;
            }
            s.parse::<f64>().unwrap_or(f64::NAN)
        }
        Value::Array(_) | Value::Object(_) => f64::NAN,
    }
}

/// `Boolean(v)`.
pub fn js_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Int(i) => *i != 0,
        Value::Float(f) => !(*f == 0.0 || f.is_nan()),
        Value::Str(s) => !s.is_empty(),
        _ => true,
    }
}

pub fn num(v: &Value) -> f64 {
    js_number(v)
}

/// `BigInt(Math.trunc(Number(v)))` (an integer stays exact).
pub fn big(v: &Value) -> Result<i128, EvalError> {
    if let Value::Int(i) = v {
        return Ok(*i);
    }
    let x = js_number(v);
    if !x.is_finite() {
        return Err(EvalError::new(
            "no_value",
            format!("cannot convert {} to an integer", js_num_str(x)),
        ));
    }
    Ok(x.trunc() as i128)
}

// ---- JS number formatting ---------------------------------------------------------------------------

/// Digits and exponent of the shortest round-trip decimal of `x` (`x = 0.d1…dk × 10^n`).
fn shortest(x: f64) -> (String, i32) {
    let s = format!("{:e}", x.abs()); // e.g. 1.2345e2 — Rust prints the shortest round-trip digits
    let (mant, exp) = s.split_once('e').unwrap();
    let exp: i32 = exp.parse().unwrap();
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0').to_string();
    let digits = if digits.is_empty() {
        "0".to_string()
    } else {
        digits
    };
    (digits, exp + 1)
}

/// `String(x)` of a JS number (ECMAScript Number::toString, radix 10).
pub fn js_num_str(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    if x == 0.0 {
        return "0".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let (digits, n) = shortest(x);
    let k = digits.len() as i32;
    if k <= n && n <= 21 {
        return format!("{sign}{digits}{}", "0".repeat((n - k) as usize));
    }
    if 0 < n && n <= 21 {
        return format!("{sign}{}.{}", &digits[..n as usize], &digits[n as usize..]);
    }
    if -6 < n && n <= 0 {
        return format!("{sign}0.{}{digits}", "0".repeat((-n) as usize));
    }
    let e = n - 1;
    let exp = if e >= 0 {
        format!("+{e}")
    } else {
        format!("-{}", -e)
    };
    if k == 1 {
        format!("{sign}{digits}e{exp}")
    } else {
        format!("{sign}{}.{}e{exp}", &digits[..1], &digits[1..])
    }
}

/// `String(v)`.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => js_num_str(*f),
        Value::Str(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| {
                if *x == Value::Null {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// Shortest decimal that round-trips `x` as binary32 (template formatting of `float`).
pub fn format_float32(x: f64) -> String {
    if !x.is_finite() || fround(x) != x {
        return js_num_str(x);
    }
    // The shortest digits that give back this binary32, printed as the JS number they denote.
    let s: f64 = format!("{:e}", x as f32).parse().unwrap();
    js_num_str(s)
}

/// A JSON string literal like `JSON.stringify`.
pub fn json_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `JSON.stringify` (numbers as JS prints them, no spaces).
pub fn js_json(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => {
            if f.is_finite() {
                js_num_str(*f)
            } else {
                "null".into()
            }
        }
        Value::Str(s) => json_quote(s),
        Value::Array(a) => format!("[{}]", a.iter().map(js_json).collect::<Vec<_>>().join(",")),
        Value::Object(o) => format!(
            "{{{}}}",
            o.iter()
                .map(|(k, x)| format!("{}:{}", json_quote(k), js_json(x)))
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

// ---- conversions --------------------------------------------------------------------------------------

/// A JSON/scenario value converted to the runtime representation of `t`.
pub fn from_json(v: &Value, t: &str) -> Value {
    if *v == Value::Null {
        return Value::Null;
    }
    if let Some(el) = t.strip_suffix("[]") {
        return match v {
            Value::Array(a) => Value::Array(a.iter().map(|x| from_json(x, el)).collect()),
            _ => v.clone(),
        };
    }
    if is_int_like(t) {
        return match v {
            Value::Bool(b) => Value::Int(*b as i128),
            Value::Int(i) => Value::Int(*i),
            Value::Float(f) => Value::Int(f.trunc() as i128),
            other => Value::Int(js_string(other).trim().parse::<i128>().unwrap_or(0)),
        };
    }
    match t {
        "float" => Value::Float(fround(js_number(v))),
        "double" => Value::Float(js_number(v)),
        "boolean" => Value::Bool(js_truthy(v)),
        "string" => Value::Str(js_string(v)),
        _ => v.clone(),
    }
}

/// Runtime value to JSON for writes/trace: int64/uint64 (and wider than 2^53) as decimal strings.
pub fn to_json(v: &Value, t: Option<&str>) -> Value {
    match v {
        Value::Int(i) => {
            if matches!(t, Some("int64") | Some("uint64")) || !(-MAX_SAFE..=MAX_SAFE).contains(i) {
                Value::Str(i.to_string())
            } else {
                Value::Int(*i)
            }
        }
        Value::Float(f) if f.fract() == 0.0 && f.abs() <= MAX_SAFE as f64 => Value::Int(*f as i128),
        Value::Array(a) => {
            let el = t.and_then(|t| t.strip_suffix("[]"));
            Value::Array(a.iter().map(|x| to_json(x, el)).collect())
        }
        other => other.clone(),
    }
}

/// Template formatting (IR_SPEC "Formatting in templates").
pub fn fmt(v: &Value, t: &str) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => {
            if t == "float" {
                format_float32(*f)
            } else {
                js_num_str(*f)
            }
        }
        Value::Str(s) => s.clone(),
        other => js_json(&to_json(other, Some(t))),
    }
}

/// Round half away from zero (ADR-0014 Notes §11), exact (`Math.round(0.49999999999999994)` is 0).
pub fn round_half_away(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let a = x.abs();
    let mut r = a.floor();
    if a - r >= 0.5 {
        r += 1.0;
    }
    if x > 0.0 {
        r
    } else if r != 0.0 {
        -r
    } else if x >= 0.0 {
        0.0
    } else {
        -0.0
    }
}

/// `type.cast`: real ⇒ integer rounds half away from zero, NaN ⇒ 0, clamp; to string with the static type.
pub fn cast(v: &Value, to: &str, from: &str) -> Value {
    if let Some((lo, hi)) = int_bounds(to) {
        let b = match v {
            Value::Int(i) => *i,
            _ => {
                let x = js_number(v);
                if x.is_nan() {
                    0
                } else if x == f64::INFINITY {
                    hi
                } else if x == f64::NEG_INFINITY {
                    lo
                } else {
                    let r = round_half_away(x);
                    if r >= hi as f64 {
                        hi
                    } else if r <= lo as f64 {
                        lo
                    } else {
                        r as i128
                    }
                }
            }
        };
        return Value::Int(b.clamp(lo, hi));
    }
    match to {
        "float" => Value::Float(fround(num(v))),
        "double" => Value::Float(num(v)),
        "string" => Value::Str(fmt(v, from)),
        "boolean" => Value::Bool(js_truthy(v)),
        _ => v.clone(),
    }
}

fn as_type(x: f64, t: &str) -> R {
    if is_int_like(t) {
        return Ok(Value::Int(big(&Value::Float(x))?));
    }
    Ok(Value::Float(if t == "float" { fround(x) } else { x }))
}

// ---- operators (the cases of values.ts `evaluate`) -------------------------------------------------------

/// `+ - *`: exact integers for integer results, else doubles (binary32 for `float`).
pub fn arith(op: &str, l: &Value, r: &Value, t: &str) -> R {
    if is_int_like(t) {
        let (a, b) = (big(l)?, big(r)?);
        let x = match op {
            "+" => a.saturating_add(b),
            "-" => a.saturating_sub(b),
            _ => a.saturating_mul(b),
        };
        return Ok(Value::Int(x));
    }
    let (a, b) = (num(l), num(r));
    as_type(
        match op {
            "+" => a + b,
            "-" => a - b,
            _ => a * b,
        },
        t,
    )
}

/// JS `/`: a double; by zero ⇒ ±Infinity, 0/0 ⇒ NaN (IEEE division is exactly that).
pub fn div(l: &Value, r: &Value) -> R {
    Ok(Value::Float(num(l) / num(r)))
}

/// JS `%` (fmod; by zero ⇒ NaN).
pub fn modulo(l: &Value, r: &Value) -> R {
    let (a, b) = (num(l), num(r));
    Ok(Value::Float(if b == 0.0 || !a.is_finite() || b.is_nan() {
        f64::NAN
    } else if b.is_infinite() {
        a
    } else {
        a % b // Rust `%` on f64 is fmod
    }))
}

pub fn neg(a: &Value) -> R {
    Ok(match a {
        Value::Int(i) => Value::Int(-i),
        other => Value::Float(-num(other)),
    })
}

pub fn compare_bool(op: &str, l: &Value, r: &Value) -> bool {
    if is_number(l) && is_number(r) {
        if let (Value::Int(a), Value::Int(b)) = (l, r) {
            return match op {
                "==" => a == b,
                "!=" => a != b,
                "<" => a < b,
                "<=" => a <= b,
                ">" => a > b,
                _ => a >= b,
            };
        }
        let (a, b) = (num(l), num(r));
        return match op {
            "==" => a == b,
            "!=" => a != b,
            "<" => a < b,
            "<=" => a <= b,
            ">" => a > b,
            _ => a >= b,
        };
    }
    match op {
        "==" => strict_eq(l, r),
        "!=" => !strict_eq(l, r),
        _ => false,
    }
}

pub fn compare(op: &str, l: &Value, r: &Value) -> R {
    Ok(Value::Bool(compare_bool(op, l, r)))
}

/// JS `===` on non-number values (strings, booleans, null; arrays/objects never equal another value).
pub fn strict_eq(l: &Value, r: &Value) -> bool {
    match (l, r) {
        (Value::Array(_), _)
        | (_, Value::Array(_))
        | (Value::Object(_), _)
        | (_, Value::Object(_)) => false,
        _ => l == r,
    }
}

pub fn land(l: &Value, r: impl FnOnce() -> R) -> R {
    Ok(Value::Bool(l.is_true() && r()?.is_true()))
}

pub fn lor(l: &Value, r: impl FnOnce() -> R) -> R {
    Ok(Value::Bool(l.is_true() || r()?.is_true()))
}

pub fn lnot(a: &Value) -> R {
    Ok(Value::Bool(!a.is_true()))
}

/// `?:`: only the chosen branch is evaluated.
pub fn pick(cond: &Value, then: impl FnOnce() -> R, otherwise: impl FnOnce() -> R) -> R {
    if cond.is_true() {
        then()
    } else {
        otherwise()
    }
}

fn js_min(xs: &[f64]) -> f64 {
    if xs.iter().any(|x| x.is_nan()) {
        f64::NAN
    } else {
        xs.iter().cloned().fold(f64::INFINITY, f64::min)
    }
}

fn js_max(xs: &[f64]) -> f64 {
    if xs.iter().any(|x| x.is_nan()) {
        f64::NAN
    } else {
        xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
    }
}

pub fn abs(a: &Value) -> R {
    Ok(match a {
        Value::Int(i) => Value::Int(i.abs()),
        other => Value::Float(num(other).abs()),
    })
}

pub fn min_max(op: &str, vs: &[Value], t: &str) -> R {
    if is_int_like(t) {
        let bs = vs.iter().map(big).collect::<Result<Vec<_>, _>>()?;
        let x = if op == "min" {
            bs.iter().min()
        } else {
            bs.iter().max()
        };
        return Ok(Value::Int(*x.unwrap_or(&0)));
    }
    let xs: Vec<f64> = vs.iter().map(num).collect();
    as_type(
        if op == "min" {
            js_min(&xs)
        } else {
            js_max(&xs)
        },
        t,
    )
}

pub fn clamp(v: &Value, lo: &Value, hi: &Value, t: &str) -> R {
    if is_int_like(t) {
        let (a, l, h) = (big(v)?, big(lo)?, big(hi)?);
        return Ok(Value::Int(if a < l {
            l
        } else if a > h {
            h
        } else {
            a
        }));
    }
    as_type(js_min(&[js_max(&[num(v), num(lo)]), num(hi)]), t)
}

pub fn round(v: &Value, digits: Option<&Value>) -> R {
    Ok(Value::Float(match digits {
        None => round_half_away(num(v)),
        Some(d) => {
            let f = 10f64.powf(num(d));
            round_half_away(num(v) * f) / f
        }
    }))
}

pub fn floor(v: &Value) -> R {
    Ok(Value::Float(num(v).floor()))
}

pub fn ceil(v: &Value) -> R {
    Ok(Value::Float(num(v).ceil()))
}

pub fn scale(v: &Value, a: &Value, b: &Value, c: &Value, d: &Value) -> R {
    let (vv, aa, bb, cc, dd) = (num(v), num(a), num(b), num(c), num(d));
    Ok(Value::Float(cc + (vv - aa) * (dd - cc) / (bb - aa)))
}

pub fn in_range(v: &Value, lo: &Value, hi: &Value) -> R {
    Ok(Value::Bool(
        compare_bool(">=", v, lo) && compare_bool("<=", v, hi),
    ))
}

pub fn array_len(a: &Value) -> R {
    Ok(Value::Int(match a {
        Value::Array(a) => a.len() as i128,
        _ => 0,
    }))
}

pub fn array_contains(a: &Value, item: &Value) -> R {
    Ok(Value::Bool(match a {
        Value::Array(a) => a.iter().any(|v| compare_bool("==", v, item)),
        _ => false,
    }))
}

pub fn array_at(a: &Value, index: &Value, default: Option<&dyn Fn() -> R>) -> R {
    let i = big(index)?;
    let items: &[Value] = match a {
        Value::Array(a) => a,
        _ => &[],
    };
    if i >= 0 && (i as usize) < items.len() {
        return Ok(items[i as usize].clone());
    }
    if let Some(d) = default {
        return d();
    }
    Err(EvalError::new(
        "array_index_out_of_range",
        format!("index {i} is outside 0…{}", items.len() as i64 - 1),
    ))
}

/// `array.at` with a default, evaluated only when the index is out of range.
pub fn array_at_or(a: &Value, index: &Value, default: impl Fn() -> R) -> R {
    array_at(a, index, Some(&default))
}

pub fn unit_convert(v: &Value, scale: &Value, offset: &Value) -> R {
    Ok(Value::Float(num(v) * num(scale) + num(offset)))
}

pub fn json_string(v: &Value, t: &str) -> R {
    Ok(Value::Str(json_quote(&fmt(v, t))))
}

/// Template formatting of one part (`V.fmt` of the other backends).
pub fn f(v: &Value, t: &str) -> String {
    fmt(v, t)
}

pub fn template(parts: &[String]) -> R {
    Ok(Value::Str(parts.concat()))
}

// ---- JSON text ⇄ Value ------------------------------------------------------------------------------------

/// Parses JSON text; integers stay exact (`Int`), other numbers are `Float`.
pub fn parse_json(text: &str) -> Result<Value, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    Ok(from_serde(&v))
}

pub fn from_serde(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i as i128)
            } else if let Some(u) = n.as_u64() {
                Value::Int(u as i128)
            } else {
                Value::Float(n.as_f64().unwrap_or(f64::NAN))
            }
        }
        serde_json::Value::String(s) => Value::Str(s.clone()),
        serde_json::Value::Array(a) => Value::Array(a.iter().map(from_serde).collect()),
        serde_json::Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), from_serde(v))).collect())
        }
    }
}

/// `JSON.parse`: every number becomes a double, like in JavaScript.
pub fn js_parse(text: &str) -> Result<Value, String> {
    fn floats(v: Value) -> Value {
        match v {
            Value::Int(i) => Value::Float(i as f64),
            Value::Array(a) => Value::Array(a.into_iter().map(floats).collect()),
            Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, floats(v))).collect()),
            other => other,
        }
    }
    parse_json(text).map(floats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_to_string_like_javascript() {
        for (x, s) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (123456789012345680000.0, "123456789012345680000"),
            (0.000001, "0.000001"),
            (-1.5, "-1.5"),
            (f64::INFINITY, "Infinity"),
            (f64::NAN, "NaN"),
            (5e-324, "5e-324"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
        ] {
            assert_eq!(js_num_str(x), s, "{x}");
        }
    }

    #[test]
    fn float32_and_rounding() {
        let f = fround(0.1);
        assert_eq!(f, 0.10000000149011612);
        assert_eq!(fmt(&Value::Float(f), "float"), "0.1");
        assert_eq!(fmt(&Value::Float(f), "double"), "0.10000000149011612");
        assert_eq!(fmt(&Value::Float(1e40), "float"), "1e+40");
        assert_eq!(round_half_away(0.5), 1.0);
        assert_eq!(round_half_away(-0.5), -1.0);
        assert_eq!(round_half_away(0.49999999999999994), 0.0);
        assert_eq!(
            round(&Value::Float(1.005), Some(&Value::Int(2))).unwrap(),
            Value::Float(1.0)
        );
    }

    #[test]
    fn casts_and_operators() {
        assert_eq!(cast(&Value::Int(300), "uint8", "int32"), Value::Int(255));
        assert_eq!(cast(&Value::Float(2.5), "int8", "double"), Value::Int(3));
        assert_eq!(cast(&Value::Float(-2.5), "int8", "double"), Value::Int(-3));
        assert_eq!(
            cast(&Value::Float(f64::NAN), "int32", "double"),
            Value::Int(0)
        );
        assert_eq!(
            cast(&Value::Float(fround(0.1)), "string", "float"),
            Value::str("0.1")
        );
        assert_eq!(
            div(&Value::Int(1), &Value::Int(0)).unwrap(),
            Value::Float(f64::INFINITY)
        );
        assert!(
            matches!(modulo(&Value::Int(1), &Value::Int(0)).unwrap(), Value::Float(x) if x.is_nan())
        );
        assert_eq!(
            modulo(&Value::Int(-7), &Value::Int(3)).unwrap(),
            Value::Float(-1.0)
        );
        assert!(compare_bool("<", &Value::Int(1), &Value::Float(1.5)));
        assert!(!compare_bool("==", &Value::Bool(true), &Value::Int(1)));
        assert!(!compare_bool("<", &Value::str("a"), &Value::str("b")));
        assert_eq!(
            land(&Value::Bool(false), || panic!("lazy")).unwrap(),
            Value::Bool(false)
        );
        assert_eq!(
            to_json(&Value::Int(i64::MAX as i128), Some("int64")),
            Value::str("9223372036854775807")
        );
        assert_eq!(to_json(&Value::Float(120.0), None), Value::Int(120));
        assert_eq!(
            json_string(&Value::str("say \"hi\"\n"), "string").unwrap(),
            Value::str("\"say \\\"hi\\\"\\n\"")
        );
        assert_eq!(
            js_json(&parse_json(r#"{"a":[1,1.5,null,"x"]}"#).unwrap()),
            r#"{"a":[1,1.5,null,"x"]}"#
        );
    }
}
