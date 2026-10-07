//! One strand of events ordered by (time, sequence) — the C++ runtime's `Strand` (ADR-0041).
//!
//! Without a clock it is virtual: `run_until` jumps from event to event (tests, conformance P1). With the
//! `host` feature, `run` executes events when they are due on a tokio current-thread runtime, where the
//! databroker and MQTT callbacks post their work: one thread, one strand.

use std::cell::{Cell, RefCell};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

type Event = Box<dyn FnOnce()>;

pub struct Strand {
    origin: Option<std::time::Instant>,
    virtual_now: Cell<i64>,
    seq: Cell<u64>,
    heap: RefCell<BinaryHeap<Reverse<(i64, u64)>>>,
    events: RefCell<HashMap<u64, Event>>,
    stopped: Cell<bool>,
    count: Cell<u64>,
    #[cfg(feature = "host")]
    wake: tokio::sync::Notify,
}

impl Default for Strand {
    fn default() -> Self {
        Strand::new_virtual()
    }
}

impl Strand {
    /// A virtual clock: time advances only from event to event.
    pub fn new_virtual() -> Self {
        Strand {
            origin: None,
            virtual_now: Cell::new(0),
            seq: Cell::new(0),
            heap: RefCell::new(BinaryHeap::new()),
            events: RefCell::new(HashMap::new()),
            stopped: Cell::new(false),
            count: Cell::new(0),
            #[cfg(feature = "host")]
            wake: tokio::sync::Notify::new(),
        }
    }

    /// The real (monotonic) clock: milliseconds since the strand was created.
    pub fn new_monotonic() -> Self {
        Strand {
            origin: Some(std::time::Instant::now()),
            ..Strand::new_virtual()
        }
    }

    pub fn now_ms(&self) -> i64 {
        match self.origin {
            Some(o) => o.elapsed().as_millis() as i64,
            None => self.virtual_now.get(),
        }
    }

    pub fn post(&self, f: impl FnOnce() + 'static) -> u64 {
        self.post_at(self.now_ms(), f)
    }

    pub fn post_at(&self, at_ms: i64, f: impl FnOnce() + 'static) -> u64 {
        let id = self.seq.get();
        self.seq.set(id + 1);
        self.heap.borrow_mut().push(Reverse((at_ms, id)));
        self.events.borrow_mut().insert(id, Box::new(f));
        #[cfg(feature = "host")]
        self.wake.notify_one();
        id
    }

    pub fn cancel(&self, id: u64) {
        self.events.borrow_mut().remove(&id);
    }

    fn pop_due(&self, limit: i64) -> Option<Event> {
        loop {
            if self.stopped.get() {
                return None;
            }
            let Reverse((at, id)) = *self.heap.borrow().peek()?;
            if at > limit {
                return None;
            }
            self.heap.borrow_mut().pop();
            let Some(f) = self.events.borrow_mut().remove(&id) else {
                continue;
            }; // cancelled
            if self.origin.is_none() && at > self.virtual_now.get() {
                self.virtual_now.set(at);
            }
            self.count.set(self.count.get() + 1);
            return Some(f);
        }
    }

    /// Virtual clock: every event up to `until_ms`; false when the app stopped the strand.
    pub fn run_until(&self, until_ms: i64) -> bool {
        while let Some(f) = self.pop_due(until_ms) {
            f();
        }
        if !self.stopped.get() && self.origin.is_none() && self.virtual_now.get() < until_ms {
            self.virtual_now.set(until_ms);
        }
        !self.stopped.get()
    }

    /// Real clock: runs events when due until `stop`.
    #[cfg(feature = "host")]
    pub async fn run(&self) {
        loop {
            while let Some(f) = self.pop_due(self.now_ms()) {
                f();
            }
            if self.stopped.get() {
                return;
            }
            let next = self.heap.borrow().peek().map(|Reverse((at, _))| *at);
            match next {
                Some(at) => {
                    let wait = (at - self.now_ms()).max(0) as u64;
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(wait),
                        self.wake.notified(),
                    )
                    .await;
                }
                None => self.wake.notified().await,
            }
        }
    }

    pub fn stop(&self) {
        self.stopped.set(true);
        #[cfg(feature = "host")]
        self.wake.notify_one();
    }

    pub fn stopped(&self) -> bool {
        self.stopped.get()
    }

    pub fn events(&self) -> u64 {
        self.count.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn orders_by_time_then_sequence_and_cancels() {
        let s = Rc::new(Strand::new_virtual());
        let seen = Rc::new(RefCell::new(Vec::new()));
        for (t, name) in [(10, "b"), (5, "a"), (10, "c")] {
            let seen = seen.clone();
            s.post_at(t, move || seen.borrow_mut().push(name));
        }
        let seen2 = seen.clone();
        let id = s.post_at(7, move || seen2.borrow_mut().push("x"));
        s.cancel(id);
        assert!(s.run_until(20));
        assert_eq!(*seen.borrow(), vec!["a", "b", "c"]);
        assert_eq!(s.now_ms(), 20);
        let s2 = s.clone();
        s.post_at(25, move || s2.stop());
        let seen3 = seen.clone();
        s.post_at(30, move || seen3.borrow_mut().push("late"));
        assert!(!s.run_until(40));
        assert!(!seen.borrow().contains(&"late"));
    }
}
