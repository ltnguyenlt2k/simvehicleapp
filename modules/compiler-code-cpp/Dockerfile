# codegen-cpp (ADR-0020, openapi/backend-plugin.v1.yaml). Build context: modules/compiler-code-cpp; contracts come
# from the `contracts` image context, never from a path outside the module (ADR-0009).
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/compiler-code-cpp
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY generator/package.json generator/bun.lock generator/bunfig.toml generator/
RUN cd generator && bun install --frozen-lockfile --production
COPY generator/src generator/src
COPY backend.yaml ./
# Served by GET /runtime/files and GET /template-overlay/files (tests excluded by .dockerignore).
COPY runtime runtime
COPY template-overlay template-overlay

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_CODEGEN_PORT=4110
COPY --from=build /src /src
USER bun
WORKDIR /src/compiler-code-cpp/generator
EXPOSE 4110
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4110/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
