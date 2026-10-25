//! `sv-wasm-host` command line (ADR-0061, contracts `abi/sv-wasm-abi.v1.md`):
//!   sv-wasm-host --precompile app.wasm app.cwasm
//!   sv-wasm-host --test app.wasm|app.cwasm cases.json [sv-app.json]   exit code = failed cases
//!   sv-wasm-host app.wasm|app.cwasm [sv-app.json]                     run on the databroker and MQTT

use std::process::ExitCode;

use anyhow::{bail, Context, Result};
use sv_wasm_host::abi::{self, Fault, Host, Limits, Line};
use sv_wasm_host::allow::Allowlist;

fn limits() -> Limits {
    let mut l = Limits::default();
    if let Some(mb) = std::env::var("SV_WASM_MAX_MEMORY_MB")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        l.max_memory_mb = mb;
    }
    if let Some(ms) = std::env::var("SV_WASM_DEADLINE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        l.deadline_ms = ms;
    }
    l
}

fn allowlist(path: Option<&String>, module: &str) -> Result<Allowlist> {
    match path {
        Some(p) => {
            Allowlist::parse(&std::fs::read_to_string(p).with_context(|| format!("reading {p}"))?)
        }
        None => Ok(Allowlist::open(
            std::path::Path::new(module)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("app"),
        )),
    }
}

fn print(lines: Vec<Line>) {
    for l in lines {
        match l {
            Line::Out(t) => println!("{t}"),
            Line::Err(t) => eprintln!("{t}"),
        }
    }
}

fn run(args: &[String]) -> Result<i32> {
    let (engine, _ticker) = abi::engine()?;
    match args.first().map(String::as_str) {
        Some("--version") => {
            println!("sv-wasm-host {} ({})", env!("CARGO_PKG_VERSION"), abi::ABI);
            Ok(0)
        }
        Some("--precompile") => {
            let [_, input, output] = args else {
                bail!("usage: sv-wasm-host --precompile app.wasm app.cwasm")
            };
            let bytes = abi::precompile(
                &engine,
                &std::fs::read(input).with_context(|| format!("reading {input}"))?,
            )?;
            std::fs::write(output, bytes).with_context(|| format!("writing {output}"))?;
            Ok(0)
        }
        Some("--test") => {
            let (Some(module), Some(cases)) = (args.get(1), args.get(2)) else {
                bail!("usage: sv-wasm-host --test app.wasm cases.json [sv-app.json]")
            };
            let m = abi::load(
                &engine,
                &std::fs::read(module).with_context(|| format!("reading {module}"))?,
            )?;
            let mut host = Host::new(
                &engine,
                &m,
                allowlist(args.get(3), module)?,
                &limits(),
                abi::monotonic(),
            )?;
            let failed = host.run_tests(
                &std::fs::read_to_string(cases).with_context(|| format!("reading {cases}"))?,
            );
            print(host.take_lines());
            Ok(failed?.clamp(0, 100))
        }
        Some(module) => {
            let m = abi::load(
                &engine,
                &std::fs::read(module).with_context(|| format!("reading {module}"))?,
            )?;
            let host = Host::new(
                &engine,
                &m,
                allowlist(args.get(1), module)?,
                &limits(),
                abi::monotonic(),
            )?;
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            tokio::task::LocalSet::new().block_on(&rt, sv_wasm_host::live::run(host))?;
            Ok(0)
        }
        None => bail!("usage: sv-wasm-host [--precompile|--test] app.wasm …"),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => ExitCode::from(code as u8),
        Err(e) => {
            if let Some(f) = e.downcast_ref::<Fault>() {
                println!("{}", abi::fault_line("app", f));
            }
            eprintln!("sv-wasm-host: {e:#}");
            ExitCode::from(101)
        }
    }
}
