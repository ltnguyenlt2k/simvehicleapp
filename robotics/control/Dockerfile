# robotics-control image: rflowc + rfrt + control API (Python 3.12). Build context: robotics/.
FROM robotics/python-base:local
WORKDIR /opt/robotics
COPY contracts/ contracts/
COPY rss/ rss/
COPY protobus/__init__.py protobus/catalog.py protobus/wire.py protobus/
COPY protobus/v1/ protobus/v1/
COPY robotflow/__init__.py robotflow/compiler.py robotflow/expr.py robotflow/registry.json robotflow/
COPY rfrt/__init__.py rfrt/
COPY control/__init__.py control/service.py control/launch.py control/
RUN python -m rss.rssc build --profile dog-go2-sim --out /catalog/catalog.json \
    && python -c "import control.service, rfrt, robotflow.compiler" \
    && mkdir -p /data && chown 10001:10001 /data
ENV PB_CATALOG=/catalog/catalog.json RC_DATA_DIR=/data PYTHONPATH=/opt/robotics
USER 10001:10001
CMD ["python", "-m", "control.service"]
