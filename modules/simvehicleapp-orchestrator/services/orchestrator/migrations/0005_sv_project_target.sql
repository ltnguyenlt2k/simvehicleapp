-- What a vehicle app runs on (ADR-0061, M20-T02): a native Velocitas app (every project before M20) or a WebAssembly
-- guest run by sv-wasm-host.
ALTER TABLE sv.project ADD COLUMN target text NOT NULL DEFAULT 'velocitas' CHECK (target IN ('velocitas', 'wasm'));
