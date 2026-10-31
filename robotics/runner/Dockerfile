FROM sr-rfrt:dev
USER root
COPY studio/control-requirements.txt /tmp/control-requirements.txt
RUN pip install --no-cache-dir -r /tmp/control-requirements.txt && pip check
WORKDIR /opt/runner
COPY runner/ ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-v"]
