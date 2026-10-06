# workspace (ADR-0026, openapi/workspace.v1.yaml). Build context: modules/simvehicleapp-orchestrator; contracts
# come from the `contracts` image context, never from a path outside the module (ADR-0009).
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/simvehicleapp-orchestrator
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY package.json bun.lock bunfig.toml ./
COPY services services
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_WORKSPACE_PORT=4040 SV_WORKSPACE_ROOT=/workspace
COPY --from=build /src /src
# uid 4000 = `vscode` of the toolchain and IDE images: files the workspace writes stay theirs (ADR-0026 §6).
RUN mkdir -p /workspace && chown 4000:4000 /workspace
USER 4000:4000
WORKDIR /src/simvehicleapp-orchestrator/services/workspace
EXPOSE 4040
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4040/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
