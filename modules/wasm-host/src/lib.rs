//! `sv-wasm-host` (ADR-0061, M20-T03): runs a SimVehicleApp vehicle app built for the `wasm` target — a
//! `wasm32-wasip1` reactor speaking `sv-wasm-abi/1` (contracts `abi/sv-wasm-abi.v1.md`) — under Wasmtime with memory
//! and time limits, and connects it to the vehicle through [`vehicle::Vehicle`].

pub mod abi;
pub mod allow;
pub mod vehicle;
