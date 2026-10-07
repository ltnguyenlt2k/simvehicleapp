//! The scenario tests SynCode generates into `tests/generated/main.rs` (their own harness prints gtest-style
//! lines); before the first SynCode there is no test.

#[cfg(sv_generated_tests)]
include!("generated/main.rs");

#[cfg(not(sv_generated_tests))]
fn main() {
    println!("[==========] 0 tests from 0 test suites ran.");
}
