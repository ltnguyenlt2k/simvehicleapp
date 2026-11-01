# Protobus ROS 2 bridge image (ADR-0066). Same ROS distro/base digest as the dog robot (Humble),
# but built only from public ROS packages and this repository. Build context: robotics/.
FROM ros:humble-ros-base-jammy@sha256:566b87e6dfc48392189a9c32e594e84060fa9948de93b04e536f39475a1f6963 AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3-pip ros-humble-rmw-cyclonedds-cpp ros-humble-vision-msgs \
    && rm -rf /var/lib/apt/lists/*
COPY protobus/ros2/requirements.txt /tmp/bridge-requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/bridge-requirements.txt && python3 -m pip check
ENV RMW_IMPLEMENTATION=rmw_cyclonedds_cpp PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
