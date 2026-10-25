import { describe, expect, test } from "bun:test";
import { kantoDescriptor } from "./kanto.ts";

describe("Kanto descriptor (M21 D14)", () => {
  test("the pushed image by digest, host network, the app's env for the vehicle's databroker and MQTT", () => {
    const d = kantoDescriptor("overspeed", "registry.local:5000/sv/overspeed:1.0", "sha256:abc123");
    expect(d).toEqual({
      container_name: "overspeed",
      image: { name: "registry.local:5000/sv/overspeed@sha256:abc123" },
      host_config: { network_mode: "host", restart_policy: { type: "unless-stopped" } },
      config: {
        env: [
          "SDV_VEHICLEDATABROKER_ADDRESS=grpc://127.0.0.1:55555",
          "SDV_MQTT_ADDRESS=mqtt://127.0.0.1:1883",
          "KUKSA_DATABROKER_API=kuksa.val.v2",
          "SV_DATABROKER_API=kuksa.val.v2",
          "SV_TRACE_LEVEL=trigger",
        ],
      },
    });
  });

  test("a reference without a tag keeps its registry port; the same image gives the same bytes", () => {
    expect(kantoDescriptor("a", "registry.local:5000/sv/a", "sha256:1").image.name).toBe("registry.local:5000/sv/a@sha256:1");
    expect(JSON.stringify(kantoDescriptor("a", "r.io/a:x", "sha256:1"))).toBe(JSON.stringify(kantoDescriptor("a", "r.io/a:x", "sha256:1")));
  });
});
