# Dev-mode runner for the existing studio (next dev) used while integrating the robot domain (M26).
FROM node:22-bookworm-slim
COPY --from=oven/bun:1.3.13 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
