FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
COPY --from=sr-studio-web-builder:spike /work/node_modules /opt/studio/node_modules
WORKDIR /opt/studio
COPY tests ./tests
ENV HOME=/tmp XDG_CACHE_HOME=/tmp/cache
USER 10001:10001
CMD ["xvfb-run", "-a", "-s", "-screen 0 1600x1000x24", "node", "tests/canvas-spike.cjs"]
