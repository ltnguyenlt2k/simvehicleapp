# Existing AI dependency CI correction

The general CI run on M22 source failed the existing osv-scan job. Public
annotations only reported exit code 1. Local reproduction with the exact pinned
scanner image isolated GHSA-6pq8-jhm2-2vcw in modules/simvehicleapp-ai/bun.lock:
transitive qs 6.16.0, moderate severity, fixed in 6.16.1. All seven other scanned
module lockfiles had no reported issues. This issue predates the robot stack;
it is not evidence that Robotics CI failed.

Official maintainer advisory:
https://github.com/ljharb/qs/security/advisories/GHSA-6pq8-jhm2-2vcw

Correction: exact qs 6.16.1 override, lockfile regenerated with Bun 1.3.8. Only
the affected resolution and duplicate nested resolution changed. No application
source, AI provider, prompt or workflow semantics changed.

Actual local validation: frozen install and TypeScript check PASS; 36 tests PASS,
1 Postgres test skipped (database fixture not configured), 0 failures. Exact
pinned OSV scanner on corrected AI lockfile: No issues found. Logs retained under
robotics/runtime/m23. No paid/live LLM calls were used.

Authenticated CI log retrieval was rejected by automatic approval review. No
credentials were retrieved; diagnosis used public status and the local scanner.
An initial shell-loop scan failed due to argument expansion and was not treated
as vulnerability evidence; seven explicit-path scans replaced it.
