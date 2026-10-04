# VSS fixtures — provenance

| File | Upstream | Ref | sha256 |
|---|---|---|---|
| `vss_rel_4.0.json` | COVESA/vehicle_signal_specification release asset `v4.0/vss_rel_4.0.json` (same file as `modules/velocitas-stack/vss/`, see `docs/BASELINE.md`) | tag `v4.0` | `925d9e1b5bd187694b3e03051a50777fdd5b46a5a5c4f48fd49ca270a07cdc50` |
| `units.yaml` | `spec/units.yaml` (v4.0 release ships no units file — ADR-0015 §6 seed) | `249dc03f3d75f96218c95483df0a32a2c3535964` (= tag `v4.0` = tip of `release/4.0`, verified 2026-10-03 via GitHub API) | `f08c865faf4dab90d3e1e1d93afba71b0ea4cae44d1d74690379b0f7595b4b96` |
| `LICENSE.VSS` | `LICENSE` | `249dc03f…` | `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5` |
| `vss_rel_4.2.json` | release asset `v4.2/vss_rel_4.2.json` | tag `v4.2` → `6024c4b29065b37c074649a1a65396b9d4de9b55` | `6de4edc9826b584c8459487ff1dc47ed3d57b3ddb31ebac4a1c4c2c170e870e3` |
| `v4.2/units.yaml` | release asset `v4.2/units.yaml` | tag `v4.2` | `fd56ea3873ce8bc949f2d1e45959ffffa6a0cb06be0d2a70e004178492b301c7` |
| `v4.2/quantities.yaml` | release asset `v4.2/quantities.yaml` | tag `v4.2` | `312d46692f9839bc7d1843fa77338379a894e63c1840406709bdbf7de1d4b04f` |

License: MPL-2.0 (file-level, whitelisted by ADR-0004). Files are unmodified copies; do not edit them —
replace from upstream and update this table. `quantities.yaml` does not exist at the v4.0 ref; v4.2 ships
`units.yaml`/`quantities.yaml` as release assets (kept under `v4.2/`, fetched 2026-10-04). `LICENSE` at the
v4.2 tag is byte-identical to `LICENSE.VSS` (same sha256).
