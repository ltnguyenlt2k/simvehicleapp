#!/usr/bin/env sh
# Regenerates protobus/v1/protobus_pb2*.py from contracts/proto (committed; CI checks they are current).
set -eu
cd "$(dirname "$0")/.."
python -m grpc_tools.protoc -I contracts/proto --python_out=. --grpc_python_out=. contracts/proto/protobus/v1/protobus.proto
