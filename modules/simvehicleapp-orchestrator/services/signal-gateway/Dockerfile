# signal-gateway (ADR-0024 §4, openapi/signal-gateway.v1.yaml). Build context: modules/simvehicleapp-orchestrator;
# contracts come from the `contracts` image context, never from a path outside the module (ADR-0009).
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/simvehicleapp-orchestrator
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY package.json bun.lock bunfig.toml ./
COPY services services
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_SIGNAL_GATEWAY_PORT=4050
COPY --from=build /src /src
USER bun
WORKDIR /src/simvehicleapp-orchestrator/services/signal-gateway
EXPOSE 4050
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4050/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
