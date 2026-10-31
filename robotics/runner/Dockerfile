FROM sr-rfrt:dev AS metadata
RUN python -I -m rfrt --runtime-info > /tmp/runtime-info.json
FROM sr-robotflow:dev AS fixtures
COPY --from=metadata /tmp/runtime-info.json /tmp/runtime-info.json
COPY runner/spikes/compile_hold.py /tmp/compile_hold.py
RUN python -c "import json,subprocess;from pathlib import Path;info=json.loads(Path('/tmp/runtime-info.json').read_text());result=subprocess.check_output(['python','/tmp/compile_hold.py',info['packageHash']]);Path('/tmp/hold-files.json').write_bytes(result)"
FROM sr-rfrt:dev
USER root
COPY studio/control-requirements.txt /tmp/control-requirements.txt
RUN pip install --no-cache-dir -r /tmp/control-requirements.txt && pip check
WORKDIR /opt/runner
COPY runner/ ./
COPY --from=sr-protobus:dev /opt/protobus/protobus/mock /opt/runner/protobus/mock
COPY control_http.py /opt/runner/control_http.py
COPY --from=fixtures /tmp/hold-files.json /fixtures/hold-files.json
COPY --from=sr-contracts:dev /contracts/studio /opt/runner/contracts/studio
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
