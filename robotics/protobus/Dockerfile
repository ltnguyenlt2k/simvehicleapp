# protobus-broker / protobus-mock / pbctl image (Python 3.12). Build context: robotics/.
FROM robotics/python-base:local
WORKDIR /opt/robotics
COPY contracts/ contracts/
COPY rss/ rss/
COPY protobus/__init__.py protobus/catalog.py protobus/wire.py protobus/provider_client.py protobus/pbctl.py protobus/bench.py protobus/
COPY protobus/v1/ protobus/v1/
COPY protobus/broker/ protobus/broker/
COPY protobus/mock/ protobus/mock/
# The catalog is built inside the image from the RSS spec, so the image and catalog hash always match.
RUN python -m rss.rssc build --profile dog-go2-sim --out /catalog/catalog.json && python -c "import protobus.broker.main, protobus.mock.provider"
RUN mkdir -p /audit && chown 10001:10001 /audit
ENV PB_CATALOG=/catalog/catalog.json
USER 10001:10001
CMD ["python", "-m", "protobus.broker.main"]
