# Contracts as a build-time image (dev phase, ADR-0009): other modules consume it through
# `additional_contexts: contracts: docker-image://${SV_CONTRACTS_IMAGE}` so their build context never
# leaves their own folder. Source files only; consumers install the dependencies from their own lockfile.
FROM scratch
COPY package.json LICENSE NOTICE CONTRACT.md /
COPY schemas /schemas
COPY openapi /openapi
COPY fixtures /fixtures
COPY packages /packages
