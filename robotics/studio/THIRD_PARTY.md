# Studio dependency provenance

Direct web packages are pinned in web/package.json and full web/package-lock.json:
React/React DOM, React Flow, Vite and Vitest (MIT); TypeScript and Playwright
(Apache-2.0). Official npm registry metadata checked2026-10-31; package integrity
hashes remain in the lock. No external font/CDN dependency is used.

HTTP control packages are fully pinned in control-requirements.txt: FastAPI and
Starlette (MIT), Uvicorn and websockets (BSD), httpx (BSD), plus their resolved
transitive dependencies. Installed wheel distributions retain upstream licenses.
Official PyPI metadata checked2026-10-31/2026-11-01. Source images and browser
images are pinned by digest in Dockerfiles. Shared HTTP dependencies do not change
the independently installed SDK wheel or import the vehicle stack.

Pinned OSV scanner found no issues for18 control packages and110 web lock
packages at local qualification. This records a result, not a permanent assurance.
