# Studio CI gate diagnosis, 2026-10-30

General CI 41052808854 at 68a9a7f0 failed the Studio Playwright step; Robotics CI
41052808838 passed. Public annotations initially contained only exit code 1;
raw logs/artifacts require GitHub login. No credentials were extracted.

The first local run accidentally targeted OTA at localhost:3000 and is invalid
Studio evidence. Corrected to the actual Studio origin localhost:3100 after
checking its published port and Better Auth URL. The full same non-live selection
then passed 45/45 in 8.3 min. A subsequent focused run reproduced a real M1 gate
failure: global getByText('New chat') matched the M10 vehicle assistant button
after its asynchronous status loaded. M1's requirement is removal of the legacy
sidebar Copilot entry, while ADR-0030 intentionally permits the separate vehicle
assistant. Source confirms those sidebar entries are removed.

Corrected the assertion to the named Workspace sidebar. The same test now mocks
the configured assistant status, explicitly opens that panel, verifies its own
New chat button exists and verifies the sidebar remains free of the legacy entry.
No retry, timeout or production UI change. Focused regression PASS / 4.1 s.
Full affected M1 group is recorded after completion below.

Added the built-in github reporter from pinned Playwright 1.63.0 alongside list
and HTML output. Its installed implementation emits test/error check annotations.
GITHUB_WORKSPACE=/repo gives correct source paths from the Docker runner. The
failed focused run already emitted a concrete assertion annotation, and the fixed
run emitted a passing summary. This preserves diagnostics for any future CI failure.

Raw original/local/focused traces are under ignored robotics/runtime/m24/
general-ci-e2e. The original GitHub failure's exact test was inaccessible, so it
is not claimed identical to the reproduced local failure. New CI must requalify
the corrected source rather than treating an unobserved rerun as proof.

Final affected M1 group: 4/4 PASS / 17.2 s, including two-session collaboration. Preceding same-selection run: 45/45 PASS before the assertion-scope change. Current CI must run the complete selection again. Diagnostic traces retained; retries remain zero.
