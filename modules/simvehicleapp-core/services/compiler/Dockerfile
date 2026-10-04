# compiler (analysis/06, openapi/compiler.v1.yaml). Build context: modules/simvehicleapp-core; contracts come
# from the `contracts` image context, never from a path outside the module (ADR-0009).
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/simvehicleapp-core
COPY --from=contracts / /src/simvehicleapp-contracts/
# Whole workspace: the frozen lockfile lists every workspace package (tests are excluded by .dockerignore).
COPY package.json bun.lock ./
COPY packages packages
COPY services services
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_COMPILER_PORT=4020
COPY --from=build /src /src
USER bun
WORKDIR /src/simvehicleapp-core/services/compiler
EXPOSE 4020
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4020/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
