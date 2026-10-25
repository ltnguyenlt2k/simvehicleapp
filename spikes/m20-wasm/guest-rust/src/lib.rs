//! M20-T01 spike guest (Rust cdylib, wasm32-wasip1): the minimal sv-wasm-abi — imports `sv.now_ms` and `sv.log`,
//! exports `sv_init` / `sv_step`.
use std::cell::RefCell;
use std::collections::BTreeMap;

#[link(wasm_import_module = "sv")]
extern "C" {
    #[link_name = "now_ms"]
    fn sv_now_ms() -> i64;
    #[link_name = "log"]
    fn sv_log(text: *const u8, len: i32);
}

fn log(s: &str) {
    unsafe { sv_log(s.as_ptr(), s.len() as i32) }
}

struct App {
    signals: BTreeMap<String, f64>,
    handlers: Vec<Box<dyn Fn(&mut BTreeMap<String, f64>, i64)>>,
    steps: i32,
}

thread_local! {
    static APP: RefCell<Option<App>> = const { RefCell::new(None) };
}

#[no_mangle]
pub extern "C" fn sv_init() -> i32 {
    let mut signals = BTreeMap::new();
    signals.insert("Vehicle.Speed".to_string(), 0.0);
    let on_step: Box<dyn Fn(&mut BTreeMap<String, f64>, i64)> = Box::new(|s, now| {
        let v = s.entry("Vehicle.Speed".into()).or_insert(0.0);
        *v += 10.0;
        if *v > 120.0 {
            log(&format!("overspeed at {now} ms: {v}"));
        }
    });
    APP.with(|a| *a.borrow_mut() = Some(App { signals, handlers: vec![on_step], steps: 0 }));
    log(&format!("Rust guest started at {}", unsafe { sv_now_ms() }));
    0
}

#[no_mangle]
pub extern "C" fn sv_step(now: i64) -> i32 {
    APP.with(|a| {
        let mut a = a.borrow_mut();
        let app = a.as_mut().expect("sv_init first");
        for h in &app.handlers {
            h(&mut app.signals, now);
        }
        app.steps += 1;
        app.steps
    })
}
