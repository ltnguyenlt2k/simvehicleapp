# Robot Studio
Independent stack under implementation, ADR-0069/0070. Current increment: RSS and
the broker data plane. The 30-minute minimal transport feasibility gate passed;
production lease/TTL/command safety, providers, workflow deployment and UI are
still in progress. No deployed robot workflow is claimed. Hardware unsupported.

From the repository root, run `bash robotics/scripts/sr build`, `precheck`, `test`
and `smoke` for RSS foundations. Broker data/protocol tests: build the contracts
image first, then `docker build -t sr-protobus:dev robotics/protobus` and
`docker run --rm --network none --cpus 2 --memory 256m sr-protobus:dev`.
Full execution evidence and remaining gates: `docs/reports/M23-progress.md`.
