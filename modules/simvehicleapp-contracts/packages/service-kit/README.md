# @simvehicleapp/service-kit

Infrastructure helpers every SimVehicleApp service uses (ADR-0007 §5–7). No business logic and no dependencies; it needs the
`@simvehicleapp/contracts` peer (inside this module it resolves through `tsconfig.json` `paths`).

```ts
import { createService } from "@simvehicleapp/service-kit";

Bun.serve({
  port: 4020,
  fetch: createService({ name: "compiler", version: "0.1.0" }, async (req, { requestId, log }) => {
    log.info("compiling");
    return Response.json({ diagnostics: [] });
  }),
});
```

- `GET /version` → ServiceInfo v1 (`commit` from `SV_COMMIT`), `GET /healthz` → `{status}` (503 when a check fails); both public.
- Every other route requires `x-sv-internal` == `INTERNAL_API_SECRET` (constant-time; unset secret ⇒ deny all).
- `x-sv-request-id` is reused when well-formed, otherwise generated, echoed on the response and bound to the logger.
- Logs: one JSON object per line on stdout (`SV_LOG_LEVEL`), bigint → decimal string; 500 responses never include error details.
