//! The WebAssembly vehicle app: the project's workflows (generated into `generated/` by SynCode) on the SimVehicleApp
//! runtime, exported to sv-wasm-host through `wasm_app!` (ADR-0061). `user_hooks.rs` is yours.

#[path = "generated/mod.rs"]
pub mod generated;
mod user_hooks;

simvehicleapp_runtime::wasm_app!(generated::wasm::app(user_hooks::on_app_start, user_hooks::on_app_stop));
