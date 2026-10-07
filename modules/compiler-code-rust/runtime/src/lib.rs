//! SimVehicleApp runtime for Rust vehicle apps (ADR-0041): the strand, the workflow runtime and the value
//! semantics shared with the reference simulator. The `host` feature adds the databroker/MQTT host
//! (`kuksa-rust-sdk`, `sdv.databroker.v1`); without it the crate has no network dependency (tests, conformance).

pub mod runtime;
pub mod strand;
pub mod testing;
pub mod values;

#[cfg(feature = "host")]
pub mod host;

pub use runtime::{
    Ctx, Expr, PubSub, Runtime, SignalRef, StateRef, StdoutTraceSink, TopicRef, TraceRecord,
    TraceSink, VehicleAccess, Workflow,
};
pub use strand::Strand;
pub use values::{EvalError, Value, R};

pub const VERSION: &str = "0.1.0";
