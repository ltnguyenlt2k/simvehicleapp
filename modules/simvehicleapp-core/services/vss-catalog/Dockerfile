# vss-catalog (ADR-0010). Build context: modules/simvehicleapp-core; contracts come from the
# `contracts` image context (modules/simvehicleapp-contracts/Dockerfile), never from a path outside the module.
FROM oven/bun:1.3.8-alpine AS build
WORKDIR /src/simvehicleapp-core
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY package.json bun.lock ./
COPY packages/vss/package.json packages/vss/
COPY services/vss-catalog/package.json services/vss-catalog/
RUN bun install --frozen-lockfile --production
COPY packages/vss/src packages/vss/src
COPY services/vss-catalog/src services/vss-catalog/src

FROM oven/bun:1.3.8-alpine
ENV NODE_ENV=production SV_VSS_SEED_DIR=/opt/sv/vss SV_VSS_CACHE_DIR=/var/cache/sv-vss SV_VSS_CATALOG_PORT=4010
COPY --from=build /src /src
# Seeded releases (LocalFileSource layout <dir>/<vX.Y>/vss_rel_X.Y.json); unmodified COVESA files, MPL-2.0.
COPY --from=contracts /fixtures/vss/vss_rel_4.0.json /fixtures/vss/units.yaml /opt/sv/vss/v4.0/
COPY --from=contracts /fixtures/vss/vss_rel_4.2.json /fixtures/vss/v4.2/units.yaml /fixtures/vss/v4.2/quantities.yaml /opt/sv/vss/v4.2/
COPY --from=contracts /fixtures/vss/LICENSE.VSS /fixtures/vss/PROVENANCE.md /opt/sv/vss/
RUN mkdir -p /var/cache/sv-vss && chown bun:bun /var/cache/sv-vss
USER bun
WORKDIR /src/simvehicleapp-core/services/vss-catalog
EXPOSE 4010
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4010/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "src/main.ts"]
