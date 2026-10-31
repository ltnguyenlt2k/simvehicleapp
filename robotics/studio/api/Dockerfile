FROM sr-robotflow:dev AS fixtures
RUN python -c "import json;from pathlib import Path;from codegen import build_application;from templates import templates;catalog=json.loads(Path('/contracts/fixtures/rss-go2-catalog.v1.json').read_text());profile=json.loads(Path('profiles/dog-go2-sim.json').read_text());profile['allowRemoteArm']=True;value=build_application(templates()['RW-C'],catalog,profile,runtime_package_hash='sha256:'+'a'*64);assert value['ok'];Path('/tmp/store-app.json').write_text(json.dumps(value['files']))"
FROM python:3.12-slim@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f
WORKDIR /opt/studio-api
COPY studio/control-requirements.txt /tmp/control-requirements.txt
COPY studio/api/requirements.txt /tmp/api-requirements.txt
RUN pip install --no-cache-dir -r /tmp/control-requirements.txt -r /tmp/api-requirements.txt && pip check
COPY --from=sr-contracts:dev /contracts /contracts
COPY --from=fixtures /tmp/store-app.json /fixtures/store-app.json
COPY studio/api/ ./
COPY control_http.py /opt/studio-api/control_http.py
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
