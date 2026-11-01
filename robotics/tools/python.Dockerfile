# Shared base for robotics Python services and tests. Build context: robotics/.
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159 AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY tools/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --root-user-action=ignore -r /tmp/requirements.txt && pip check

# Dev/test image: adds protoc and pytest; never used for services.
FROM base AS dev
COPY tools/requirements-dev.txt /tmp/requirements-dev.txt
RUN pip install --no-cache-dir --root-user-action=ignore -r /tmp/requirements-dev.txt && pip check
WORKDIR /w
