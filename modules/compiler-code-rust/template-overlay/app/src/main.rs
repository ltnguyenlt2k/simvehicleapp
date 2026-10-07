//! The vehicle app: the project's workflows on the SimVehicleApp runtime (ADR-0041).
//! Installed once when the project is created; the workflows themselves are generated into `generated/`.

mod user_hooks;

use app::generated::app::{APP_NAME, TRACE_LEVEL, WORKFLOWS};
use simvehicleapp_runtime::host::{run, App};

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let app = App {
        name: APP_NAME,
        workflows: WORKFLOWS,
        trace_level: TRACE_LEVEL,
        on_app_start: user_hooks::on_app_start,
        on_app_stop: user_hooks::on_app_stop,
    };
    if let Err(e) = tokio::task::LocalSet::new().block_on(&runtime, run(app)) {
        eprintln!("{APP_NAME}: {e}");
        std::process::exit(1);
    }
}
