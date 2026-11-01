# Protobus ROS 2 bridge image (ADR-0066). Same ROS distro/base digest as the dog robot (Humble), built only from
# public ROS packages, this repository and the pinned dog message contract. Build context: robotics/.
FROM ros:humble-ros-base-jammy@sha256:566b87e6dfc48392189a9c32e594e84060fa9948de93b04e536f39475a1f6963 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ros-humble-rmw-cyclonedds-cpp ros-humble-vision-msgs \
    && rm -rf /var/lib/apt/lists/*
COPY protobus/ros2/requirements.txt /tmp/bridge-requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/bridge-requirements.txt && python3 -m pip check
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

FROM base AS interfaces
RUN apt-get update && apt-get install -y --no-install-recommends \
      ros-humble-rosidl-default-generators python3-colcon-common-extensions \
    && rm -rf /var/lib/apt/lists/*
COPY protobus/ros2/interfaces/ /ws/src/
RUN . /opt/ros/humble/setup.sh && cd /ws && colcon build --merge-install --install-base /opt/robot_interfaces

FROM base AS bridge
COPY --from=interfaces /opt/robot_interfaces /opt/robot_interfaces
WORKDIR /opt/robotics
COPY protobus/__init__.py protobus/catalog.py protobus/wire.py protobus/provider_client.py protobus/
COPY protobus/v1/ protobus/v1/
COPY protobus/ros2/__init__.py protobus/ros2/transforms.py protobus/ros2/bridge.py protobus/ros2/live_checks.py protobus/ros2/
COPY protobus/ros2/cyclonedds.xml /etc/protobus/cyclonedds.xml
COPY protobus/ros2/profiles/dog-go2-sim/mapping.json /mapping/mapping.json
COPY --from=robotics/protobus:local /catalog/catalog.json /catalog/catalog.json
RUN printf '#!/bin/sh\nset -e\n. /opt/ros/humble/setup.sh\n. /opt/robot_interfaces/setup.sh\nexec "$@"\n' > /entrypoint.sh \
    && chmod 755 /entrypoint.sh \
    && /entrypoint.sh python3 -c "import protobus.ros2.bridge; from dog_interfaces.msg import FootContacts"
ENV CYCLONEDDS_URI=file:///etc/protobus/cyclonedds.xml PB_CATALOG=/catalog/catalog.json PB_MAPPING=/mapping/mapping.json
USER 10001:10001
ENTRYPOINT ["/entrypoint.sh"]
CMD ["python3", "-m", "protobus.ros2.bridge"]
