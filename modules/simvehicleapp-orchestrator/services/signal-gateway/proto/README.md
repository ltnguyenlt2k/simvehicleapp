# kuksa.val.v1 and kuksa.val.v2 protos (vendored, unmodified)

- Source: https://github.com/eclipse-kuksa/kuksa-proto, commit `28bf76ae57085dad425eedd95bc7bd442e1314a7` (the `proto` submodule of
  kuksa-databroker tag `0.7.1`, the databroker pinned in docs/BASELINE.md), `kuksa/val/v1/{val,types}.proto` (identical to 0.5.0)
  and `kuksa/val/v2/{val,types}.proto` (2026-10-25, M21 D11: adds ProvideSignal, GetProviderValue, UpdateFilter, filters).
- License: Apache-2.0 (headers kept in each file), Copyright (c) 2022 (v1), 2024 (v2) Contributors to the Eclipse Foundation.
- Used by the signal-gateway to read, inject and subscribe (ADR-0024 §4). Update together with the databroker pin.
- v2 is used for the provider role of apps on `kuksa.val.v2` (ADR-0047 §2): OpenProviderStream, ListMetadata. The gateway only provides
  actuations (ProvideActuationRequest) and writes the accepted value over v1: since 0.6.1 a provider that publishes on the stream
  must claim the signals (ProvideSignalRequest), and the databroker then routes reads and filter updates to it (M21 D11).
