FROM python:3.12-slim@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SOURCE_DATE_EPOCH=315532800 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /opt/rfrt-build
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=sr-contracts:dev /contracts /contracts
COPY build-requirements.txt .
RUN pip install --no-cache-dir -r build-requirements.txt && python -m grpc_tools.protoc -I/contracts --python_out=. --grpc_python_out=. /contracts/protobus/v1/protobus.proto
# Data-only compiler output fixtures; no compiler implementation import.
COPY --from=sr-robotflow:dev /opt/robotflow/goldens /fixtures
COPY . .
RUN mkdir -p rfrt/contracts && cp /contracts/*.json rfrt/contracts/
RUN cp /contracts/protobus/v1/protobus.proto rfrt/protobus.proto && pip wheel --no-deps --no-build-isolation --no-index -w /tmp/wheel-a . && pip wheel --no-deps --no-build-isolation --no-index -w /tmp/wheel-b . && cmp /tmp/wheel-a/*.whl /tmp/wheel-b/*.whl && mkdir /opt/rfrt-runtime && cp /tmp/wheel-a/*.whl /opt/rfrt-runtime/ && pip install --no-deps --no-compile /opt/rfrt-runtime/*.whl && python -c "from pathlib import Path; import hashlib; p=Path('/opt/rfrt-runtime'); (p/'package.sha256').write_text('sha256:'+hashlib.sha256(next(p.glob('*.whl')).read_bytes()).hexdigest()+'\n')"
WORKDIR /opt/rfrt-tests
COPY tests ./tests
USER 10001:10001
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
