# Upstream provenance (velocitas-stack)

| Path | Upstream | Pinned commit | Fetched | License |
|---|---|---|---|---|
| `templates/vehicle-app-cpp-template/` | https://github.com/eclipse-velocitas/vehicle-app-cpp-template | `275e858e3de8f43d6b4c71a389e358dffe73b42b` (2026-01-05) | 2026-10-01 | Apache-2.0 (LICENSE, NOTICE.md kept) |
| `templates/vehicle-app-python-template/` | https://github.com/eclipse-velocitas/vehicle-app-python-template | `e7082f75d1831489462f6672b6858f7ea7708256` (2025-07-07) | 2026-10-01 | Apache-2.0 |
| `vss/vss_rel_4.0.json` | https://github.com/COVESA/vehicle_signal_specification/releases/download/v4.0/vss_rel_4.0.json | sha256 `925d9e1b5bd187694b3e03051a50777fdd5b46a5a5c4f48fd49ca270a07cdc50` | 2026-10-01 | MPL-2.0 |
| toolchain images: `/usr/local/bin/kuksa-databroker` (+ `/usr/share/licenses/kuksa-databroker/`) | `ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0` (`/app/databroker`, binary only, copied at image build — ADR-0057 per-run sandboxes) | image digest `sha256:4fa9d98197fd7d144dccfba9473e83ea30b7eff3afb06e2acf558c588b8da1cc` (docs/BASELINE.md) | 2026-10-16 | Apache-2.0; the image's `thirdparty-licenses/` and `sbom.json` are copied with it |

Images pinned in `compose.yaml` / Dockerfiles: `devcontainer-base-images/cpp:v0.4` (via template `.devcontainer/Dockerfile`), `kuksa-databroker:0.5.0`, `eclipse-mosquitto:2.0.14`, `kuksa-mock-provider/mock-provider:0.4.1`.
Built into toolchain image at build time: `vehicle-app-cpp-sdk` bare mirror tag `v0.7.1`; googletest archive referenced by the template.

**Template files are kept pristine.** SimVehicleApp changes are applied by scripts at build/init time:
`toolchain/cpp/sv-localize-vss.py` (AppManifest VSS src → `app/vss/…` in the project) and
`toolchain/cpp/sv-offline-overlay.py` (no-op-unless-env googletest guard). To compare with upstream:
`git diff --no-index <fresh clone> templates/vehicle-app-cpp-template`.
