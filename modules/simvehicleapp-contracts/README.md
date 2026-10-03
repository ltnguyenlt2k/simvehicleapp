# simvehicleapp-contracts

Source of truth for every schema/API between modules plus shared fixtures (ADR-0007; spec: [analysis/modules/simvehicleapp-contracts.md](../../analysis/modules/simvehicleapp-contracts.md)).
Package: `@simvehicleapp/contracts@1.0.0-alpha.1` (M00-T05/T06, in progress).

```bash
bun install
bun test          # validates fixtures + positive/negative cases for every schema
bun run gen       # regenerate packages/ts/src/types/index.ts from schemas/
bun run check     # generated types up to date + tsc
```

Consumers (other modules) depend only on this package, e.g. `bun link` / `bun add file:../simvehicleapp-contracts`:
```ts
import { ContractValidator, type IRV1 } from "@simvehicleapp/contracts";
new ContractValidator().assert("ir", ir);                     // whole schema
new ContractValidator().validate("toolchain-job#/$defs/request", body); // a $defs body
```

Layout: `schemas/` (JSON Schema 2020-12, `$id = urn:simvehicleapp:contracts:<name>:<version>`), `fixtures/` (VSS seed + golden),
`packages/ts/src/` (validator + generated types), `tools/` (generators). What is provided and the alpha decisions: [CONTRACT.md](CONTRACT.md).
