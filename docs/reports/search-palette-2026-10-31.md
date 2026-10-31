# Search palette candidate regression fix

General CI41166426026 failed M18/Create workflow while44 other cases passed.
The old local image passed isolated M18 (1/1,17.8s) and new six-reopen regression
(1/1,7.2s); intermittent CI failure is not reliably reproduced. Source has an
uncontrolled input and a passive native DOM reset that can erase newly typed
text. Minimal candidate binds value to existing search state, resets on open
synchronously and retains only focus in the effect. No service/workflow change.

Fresh local build was interrupted after WSL/host memory pressure and connection
timeouts during Next build; it is not a successful verification. Existing running
image was not replaced. CI build/typecheck/E2E for the candidate is required;
no pass claim based on source review. Full robot workflow video remains separate.
