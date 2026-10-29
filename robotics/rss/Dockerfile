FROM python:3.12-slim@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f
WORKDIR /opt/rss
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=sr-contracts:dev /contracts /contracts
COPY . .
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RSS_CONTRACTS=/contracts
USER 10001:10001
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
