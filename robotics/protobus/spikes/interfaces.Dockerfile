FROM ros:humble-ros-base-jammy@sha256:566b87e6dfc48392189a9c32e594e84060fa9948de93b04e536f39475a1f6963
WORKDIR /interface_ws
COPY interface-source/dog_interfaces src/dog_interfaces
RUN . /opt/ros/humble/setup.sh && colcon build --packages-select dog_interfaces
CMD ["/bin/bash", "-c", ". /opt/ros/humble/setup.sh && . /interface_ws/install/setup.sh && python3 -c 'from dog_interfaces.msg import FootContacts; print(FootContacts())'"]
