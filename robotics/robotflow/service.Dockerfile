FROM sr-robotflow:dev
USER root
COPY studio/control-requirements.txt /tmp/control-requirements.txt
RUN pip install --no-cache-dir -r /tmp/control-requirements.txt && pip check
COPY robotflow/http_service.py /opt/robotflow/http_service.py
COPY robotflow/service_tests /opt/robotflow/service_tests
USER 10001:10001
CMD ["uvicorn", "http_service:api", "--host", "0.0.0.0", "--port", "8012", "--no-access-log", "--limit-concurrency", "16"]
