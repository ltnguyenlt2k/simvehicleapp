/**
 * Eclipse Kanto deployment of an app image (ADR-0050 Notes, M21 D14): the container-management descriptor a vehicle
 * running kanto-cm v1.0.0 reads from its `deployment.ctr_dir` (`types.Container` JSON, `util.ReadContainer`). SimVehicleApp
 * does not run Kanto (it would need control of a container runtime, hard rule 10): it hands the file over with the image.
 * On the vehicle the app shares the host network with Kanto's databroker and MQTT broker.
 */
export interface KantoDescriptor {
  container_name: string;
  image: { name: string };
  host_config: { network_mode: "host"; restart_policy: { type: "unless-stopped" } };
  config: { env: string[] };
}

export function kantoDescriptor(slug: string, reference: string, digest: string): KantoDescriptor {
  // By digest: the vehicle runs exactly the image that was pushed, whatever the tag points to later.
  const repository = reference.replace(/:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/, "");
  return {
    container_name: slug,
    image: { name: `${repository}@${digest}` },
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
  };
}
