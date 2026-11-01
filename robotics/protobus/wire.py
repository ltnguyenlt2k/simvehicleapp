"""Conversions between Python values and protobus.v1 messages."""
from __future__ import annotations

from google.protobuf import json_format, struct_pb2

from protobus.v1 import protobus_pb2 as pb


def to_value(value) -> struct_pb2.Value:
    out = struct_pb2.Value()
    if value is None:
        out.null_value = struct_pb2.NULL_VALUE
    elif isinstance(value, bool):
        out.bool_value = value
    elif isinstance(value, (int, float)):
        out.number_value = float(value)
    elif isinstance(value, str):
        out.string_value = value
    else:
        json_format.ParseDict(value, out)
    return out


def from_value(value: struct_pb2.Value):
    kind = value.WhichOneof("kind")
    if kind in (None, "null_value"):
        return None
    if kind == "bool_value":
        return value.bool_value
    if kind == "number_value":
        return value.number_value
    if kind == "string_value":
        return value.string_value
    return json_format.MessageToDict(value)


def to_struct(data: dict) -> struct_pb2.Struct:
    out = struct_pb2.Struct()
    out.update(data or {})
    return out


def from_struct(data: struct_pb2.Struct) -> dict:
    return json_format.MessageToDict(data)


TERMINAL = {pb.SUCCEEDED, pb.FAILED, pb.REJECTED, pb.CANCELLED, pb.TIMED_OUT}
PHASE = pb.CommandPhase
