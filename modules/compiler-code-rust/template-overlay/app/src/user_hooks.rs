//! Your code around the generated workflows (installed once; SynCode never touches this file).
//!
//! The workflows themselves are generated into `generated/` from the canvas — edit them there, not in
//! Rust. Use these hooks for set-up and clean-up that the blocks do not cover.

/// Runs once the vehicle data broker is connected, before the workflows start.
pub fn on_app_start() {}

/// Runs when the app stops (SIGTERM/SIGINT or a Stop block with scope "app").
pub fn on_app_stop() {}
