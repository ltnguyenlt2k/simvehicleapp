# ADR-0087: Studio control listeners and immutable deployments

Status: implementation design under user authorization; acceptance pending.
M25 native local acceptance is recorded at f8029821; candidate CI is pending.

## Boundaries

Keep the independent Studio from ADR0068/0069. nginx serves static React Flow
and proxies HTTP/WebSocket to studio-api. Only API writes projects/artifacts.
rflowc returns diagnostics or the exact ten compiler files; it does not run code.

Two prestarted nonroot runners have fixed mode, broker and separate bus/control
networks. API joins front, sim-control and live-control, but listens only on its
front interface. A sim application cannot use API as an indirect route to live.
Runners listen only on their control interface. Explicit Docker interface names
and actual negative reachability tests qualify these boundaries. No Docker socket.

Native children use the installed SDK, immutable read-only artifacts, clean
environment, bounded logs/events, private temporary space and measured resource
limits. One run per robot/mode. Stop uses independent broker safety and bounded
process cleanup. Restart never resumes a run or acquires a lease automatically.
Only compiler-generated code is accepted; browser supplies closed workflow JSON,
never arbitrary Python or file sets. This local single-user model has weaker
isolation than per-app containers; mode separation remains mandatory.

## Records and Robot Zoo

Projects use bounded UUIDs, revision checks and atomic saves. Artifacts are
immutable by verified hash. Deployment records freeze source/catalog/profile/
runtime identities, mode and explicitly observed TargetBinding. Deploy never
starts or Arms. Start never replaces a stale binding.

Runner APIs provide capabilities, target/live reads, run/status/log/event and
independent Stop. Scenario injection exists only on sim runner, using the actual
mock API with timeScale=1 and typed bounded expectations. Client URLs are never
forwarded as execution destinations.

Optional Dog integration attaches only gateway to Studio front; DDS stays eth0.
A fixed allowlisted server URL and internal service capability file authorize
only live deployment control. Browser link carries deployment UUID only. Zoo
provides status/logs and explicit Start/Stop. Page load, Deploy and reconnection
never launch motion. Checked local Origin or the Zoo service capability protects
writes. User sign-in and AI remain outside v0.1.

## Qualification

Candidate versions from official registry metadata checked 2026-10-31:
React19.3.1, React Flow12.12.0, Vite8.3.5, TypeScript7.0.2, Vitest5.0.5,
Playwright1.64.1; FastAPI0.162.0, Uvicorn0.54.0 and httpx0.28.1. Freeze resolved
dependencies, image digests and qualify/scanner before accepting them.

S-R5 measures200 custom nodes, typed handles and keyboard, drag>=30fps, static
build<120s and peak RAM<2GiB. S-R6 measures actual SDK process uid/limits,
read-only artifacts, rejected concurrent run, bounded cleanup, memory failure
and denied outside/opposite-mode/API reachability. M26 adds HTTP/unit/browser
mock gates. M27 separately requires three complex live runs, faults/restarts,
30min soak and one continuous cross-tab recording of real UI creation, editing,
verification, build/deploy and Zoo Start.

Official implementation references:
- https://reactflow.dev/learn/customization/custom-nodes
- https://vite.dev/guide/
- https://fastapi.tiangolo.com/advanced/websockets/
