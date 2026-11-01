# Full-flow recorder (ADR-0071): Xvfb + real browser windows + ffmpeg x11grab. Build context: robotics/.
FROM mcr.microsoft.com/playwright@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg x11-utils libgl1-mesa-dri libegl-mesa0 libgles2 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/video
COPY scripts/video/package.json ./
RUN npm install --no-audit --no-fund --omit=dev && npm ls playwright
