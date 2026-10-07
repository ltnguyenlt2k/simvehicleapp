//! The vehicle app's library: the code SynCode generates from the workflows (`src/generated/`, chosen by
//! `build.rs`; before the first SynCode an app without workflows).

include!(concat!(env!("OUT_DIR"), "/generated.rs"));
