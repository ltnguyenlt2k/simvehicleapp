# kuksa.val.v1 and kuksa.val.v2 protos (vendored, unmodified)

- Source: https://github.com/eclipse-kuksa/kuksa-databroker — tag `0.5.0`, commit `30e5c13abc496d0b39aaa6c25acebb088b9902e3`,
  `proto/kuksa/val/v1/{val,types}.proto` and `proto/kuksa/val/v2/{val,types}.proto` (git blob 2756ac1 / 8955f6d), the databroker image pinned in ADR-0024.
- License: Apache-2.0 (headers kept in each file), Copyright (c) 2022 (v1), 2024 (v2) Contributors to the Eclipse Foundation.
- Used by the signal-gateway to read, inject and subscribe (ADR-0024 §4). Update together with the databroker pin.
- v2 is used for the provider role of apps on `kuksa.val.v2` (ADR-0047 §2): OpenProviderStream, ListMetadata.
