#!/usr/bin/env bash
set -eo pipefail
source /opt/ros/humble/setup.bash
source /interface_ws/install/local_setup.bash
set -u
exec "$@"
