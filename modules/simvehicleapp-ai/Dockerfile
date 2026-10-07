# ai-assistant (ADR-0030, openapi/ai-assistant.v1.yaml). Build context: modules/simvehicleapp-ai; contracts come
# from the `contracts` image context, never from a path outside the module (ADR-0009).
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/simvehicleapp-ai
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY src src
COPY migrations migrations

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_AI_PORT=4300
COPY --from=build /src /src
USER bun
WORKDIR /src/simvehicleapp-ai
EXPOSE 4300
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4300/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
