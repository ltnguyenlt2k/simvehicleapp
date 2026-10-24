import { describe, expect, test } from "bun:test";
import { actuateSignal, batchRequests, fields, grpcFrame, grpcMessages, metadataIds, stringMessage } from "./protobuf.ts";

const bytes = (...xs: number[]) => Uint8Array.from(xs);
const len = (no: number, inner: Uint8Array) => bytes((no << 3) | 2, inner.length, ...inner);

describe("protobuf wire reading (vehicle-gateway)", () => {
  test("the signal of an Actuate request, by path or by id", () => {
    const byPath = len(1, stringMessage(2, "Vehicle.Body.Lights.Hazard.IsSignaling"));
    expect(actuateSignal(byPath)).toEqual({ path: "Vehicle.Body.Lights.Hazard.IsSignaling" });
    const byId = len(1, bytes(0x08, 0x41)); // id = 65
    expect(actuateSignal(byId)).toEqual({ id: 65 });
    expect(actuateSignal(bytes())).toBeNull();
    const batch = Uint8Array.from([...len(1, byPath), ...len(1, byId)]);
    expect(batchRequests(batch).map(actuateSignal)).toEqual([{ path: "Vehicle.Body.Lights.Hazard.IsSignaling" }, { id: 65 }]);
  });

  test("ids of ListMetadata, gRPC framing, a varint over one byte", () => {
    const meta = (id: number) => len(1, bytes(0x50, id & 0x7f | 0x80, id >> 7)); // field 10, two-byte varint
    expect(metadataIds(Uint8Array.from([...meta(300), ...meta(129)]))).toEqual([300, 129]);
    const m = stringMessage(1, "Vehicle.Speed");
    expect(grpcMessages(Uint8Array.from([...grpcFrame(m), ...grpcFrame(m)]))).toEqual([m, m]);
    expect(() => grpcMessages(Uint8Array.from([1, 0, 0, 0, 0]))).toThrow("compressed");
    expect(() => fields(bytes(0x0a, 5, 1))).toThrow("truncated");
  });
});
