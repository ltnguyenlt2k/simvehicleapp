# M14 — Mở rộng sau v1.0 (backlog có thứ tự)

Mỗi mục cần ADR riêng trước khi làm.

| # | Hạng mục | ADR | Ghi chú |
|---|---|---|---|
| 1 | Curated multi-VSS blocks (Battery Status, Door/Lock Status, Climate Status) | 0045 | Master Plan Phase 23; BlockSpec `lowering` nhiều node |
| 2 | gRPC service interface (`service.grpc_call`, AppManifest `grpc-interface`, `velocitas exec grpc-interface-support generate-sdk`) | 0043 | Phase 24 |
| 3 | Standalone service apps (1 workflow → 1 Vehicle App riêng, giao tiếp pub/sub/gRPC) | 0044 | Phase 25 |
| 4 | Per-run runtime stack & multi-user workspaces | 0046 | cần orchestrator điều khiển container ⇒ cân nhắc docker socket proxy có giới hạn hoặc chuyển K8s |
| 5 | Migrate `kuksa.val.v2` + databroker mới + provider | 0047 | |
| 6 | Quick Run interpreter app | 0048 | chỉ nếu nhu cầu thực tế |
| 7 | Sub-workflow/function, state machine block, filters | — | |
| 8 | Kanto deployment (`runtime-kanto`, `deployment-kanto`) | — | |
| 9 | Reverse proxy + SSO forward-auth cho IDE | — | |
| 10 | VSS overlay OEM (vss-tools pipeline) | — | |
