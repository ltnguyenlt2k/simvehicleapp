//! Generated code is written by SynCode into `src/generated/` and `tests/generated/` (directories the template
//! leaves empty, ADR-0026). This script points the crate at it when it is there, or at an app without
//! workflows before the first SynCode.

use std::path::Path;

fn main() {
    println!("cargo::rustc-check-cfg=cfg(sv_generated_tests)");
    println!("cargo::rerun-if-changed=src/generated");
    println!("cargo::rerun-if-changed=tests/generated");
    let generated = Path::new("src/generated/mod.rs");
    let module = if generated.exists() {
        let path = generated.canonicalize().expect("src/generated/mod.rs");
        format!(
            "#[path = {:?}]\npub mod generated;\n",
            path.display().to_string()
        )
    } else {
        "/// Before the first SynCode: an app without workflows.\npub mod generated {\n    pub mod app {\n        use simvehicleapp_runtime::Runtime;\n\n        pub const APP_NAME: &str = \"SampleApp\";\n        pub const TRACE_LEVEL: &str = \"node\";\n        pub const WORKFLOWS: &[fn(&Runtime)] = &[];\n        pub const SIGNALS: &[(&str, &str)] = &[];\n    }\n    pub mod workflows {}\n}\n".to_string()
    };
    let out = std::env::var("OUT_DIR").expect("OUT_DIR");
    std::fs::write(Path::new(&out).join("generated.rs"), module).expect("write generated.rs");
    if Path::new("tests/generated/main.rs").exists() {
        println!("cargo::rustc-cfg=sv_generated_tests");
    }
}
