FROM ros:humble-ros-base-jammy@sha256:566b87e6dfc48392189a9c32e594e84060fa9948de93b04e536f39475a1f6963
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip ros-humble-rmw-cyclonedds-cpp && rm -rf /var/lib/apt/lists/*
WORKDIR /interface_ws
COPY interface-source/dog_interfaces src/dog_interfaces
COPY interface-source/LICENSE interface-source/NOTICE interface-source/manifest.json /opt/interface-provenance/
RUN . /opt/ros/humble/setup.sh && colcon build --packages-select dog_interfaces
WORKDIR /opt/protobus
COPY bridge-requirements.txt .
RUN python3 -m pip install --no-cache-dir --target /opt/protobus-deps -r bridge-requirements.txt
COPY --from=sr-contracts:dev /contracts /contracts
COPY bridge-build-requirements.txt .
RUN python3 -m pip install --no-cache-dir --target /opt/protobus-build-deps -r bridge-build-requirements.txt && PYTHONPATH=/opt/protobus-build-deps python3 -m grpc_tools.protoc -I/contracts --python_out=. --grpc_python_out=. /contracts/protobus/v1/protobus.proto /contracts/protobus/mock/v1/mock.proto && rm -rf /opt/protobus-build-deps
COPY . .
RUN mkdir -p /data && chown 10001:10001 /data
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/protobus:/opt/protobus-deps ROS_LOG_DIR=/tmp/ros RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
USER 10001:10001
ENTRYPOINT ["/bin/bash", "/opt/protobus/bridge-entrypoint.sh"]
CMD ["python3", "-m", "bridge_image_smoke"]
