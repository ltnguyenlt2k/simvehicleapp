# 11a — Thay thế `apps/sim/ee/` bằng code tự viết (clean-room)

> Bổ sung cho [11-sim-refactor-plan](11-sim-refactor-plan.md) và [ADR-0004](adr/ADR-0004-license-compliance.md). Khảo sát trên snapshot Sim `v0.7.13` (`ad0b8678…`), 2026-10-01.
> ⚠️ Không phải tư vấn pháp lý — trước khi thương mại hoá nên để luật sư xác nhận quy trình clean-room.

## 1. `ee/` là gì
`apps/sim/ee/` = **Sim Enterprise Edition**: 28 file (UI component, React hook, vài hàm helper), **không** gồm backend.

| Thư mục | Chức năng |
|---|---|
| `whitelabeling/` (9 file) | brand config (tên, logo, màu), metadata, inject theme CSS, branding theo organization |
| `access-control/` (4) | permission groups: chặn model/provider/block/MCP/invite/public API theo nhóm |
| `sso/` (5) | UI cấu hình & đăng nhập SSO (OIDC/SAML) |
| `audit-logs/` (3) | UI xem audit log |
| `data-drains/` (3) | UI đẩy dữ liệu ra hệ thống ngoài |
| `data-retention/` (2) | UI chính sách lưu trữ dữ liệu |
| `components/` (2) | `InfoNote`, `SettingRow` (UI nhỏ) |

**License (`ee/LICENSE`, "Sim Enterprise License"):** chỉ dùng cho dev/test/evaluation và nội bộ non-production; production cần subscription; **cấm modify, cấm tạo derivative works, cấm redistribute**. ⇒ Không được ship, không được sửa rồi dùng.

## 2. Ranh giới input/output — nằm ở phần Apache
Backend của các tính năng này **không** ở `ee/` mà ở core Apache-2.0:
- API routes: `app/api/permission-groups`, `app/api/audit-logs`, `app/api/auth/sso`, `app/api/organizations/[id]/data-retention`, `app/api/organizations/[id]/whitelabel`.
- DB schema: `packages/db/schema.ts`.
- SSO backend: plugin `@better-auth/sso` (bên thứ ba) được bật trong `lib/auth/auth.ts`.

Core gọi vào `ee/` từ **61 file Apache**, qua đúng các symbol sau (lấy từ câu lệnh `import` trong file Apache, **không đọc nội dung `ee/`**):

| Module `@/ee/...` | Symbol core sử dụng |
|---|---|
| `whitelabeling` (+ `/branding`, `/hooks/whitelabel`, `/org-branding`, `/org-branding-utils`, `/components/branding-provider`) | `getBrandConfig`, `useBrandConfig`, `generateBrandedMetadata`, `generateThemeCSS`, `BrandingProvider`, `getOrgWhitelabelSettings`, `mergeOrgBrandConfig`, `generateOrgThemeCSS`, `useWhitelabelSettings`, `useUpdateWhitelabelSettings`, type `WhitelabelSettingsPayload` |
| `access-control/utils/permission-check` | `getUserPermissionConfig`, `assertPermissionsAllowed`, `resolveWorkspaceGroup`, `validateBlockType`, `validateModelProvider`, `validateMcpToolsAllowed`, `validateCustomToolsAllowed`, `validateSkillsAllowed`, `validateInvitationsAllowed`, `validatePublicApiAllowed`, `validatePublicFileSharing`, error classes `IntegrationNotAllowedError`, `InvitationsNotAllowedError`, `McpToolsNotAllowedError`, `ModelNotAllowedError`, `ProviderNotAllowedError`, `PublicApiNotAllowedError`, `PublicFileSharingNotAllowedError` |
| `access-control/hooks/permission-groups` | `usePermissionGroups`, `useCreate/Update/DeletePermissionGroup`, `usePermissionGroupMembers`, `useBulkAddPermissionGroupMembers`, `useRemovePermissionGroupMember`, `useOrganizationWorkspaces`, `useUserPermissionConfig`, type `PermissionGroup` |
| `sso/*` | `SSOAuth`, `SSOForm`, `useSSOProviders`, `useConfigureSSO`, `SSO_TRUSTED_PROVIDERS` |
| `audit-logs/*` | `useAuditLogs`, type `AuditLogFilters`, `RESOURCE_TYPE_OPTIONS` |
| `data-drains/*` | `useDataDrains`, `useCreate/Update/DeleteDataDrain`, `useDataDrainRuns`, `useRunDataDrainNow`, `useTestDataDrain`, `DESTINATION_FORM_REGISTRY` |
| `data-retention/hooks` | `useOrganizationRetention`, `useUpdateOrganizationRetention` |
| `components/*` | `InfoNote`, `SettingRow` |

> **Đính chính 2026-10-03 (M01-T02a):** đếm lại từ file Apache — chỉ `whitelabeling` (36), `permission-check` (21 + 1 import động), `useUserPermissionConfig` (1) và 4 symbol SSO được import; `InfoNote`/`SettingRow`, hooks audit-logs/data-drains/data-retention và một số symbol whitelabeling/permission-groups trong bảng trên chỉ dùng nội bộ `ee/`. 6 component settings được import động trong `settings.tsx`. Spec chi tiết: [docs/specs/M01-T02a-oss-clean-room-spec.md](../docs/specs/M01-T02a-oss-clean-room-spec.md).

Hợp đồng chi tiết (tham số, kiểu trả về) được suy ra **chỉ** từ: cách 61 file Apache gọi các symbol trên, request/response của API routes Apache, schema DB, và tài liệu công khai.

## 3. Có làm được không? — Có, theo quy trình clean-room
Bản quyền bảo hộ **cách viết code**, không bảo hộ chức năng hay giao diện gọi. Viết lại từ đầu dựa trên input/output là cách làm phổ biến, với điều kiện:

1. **Người viết lại không đọc source `ee/`.** Người viết spec chỉ đọc phần Apache (call site, API route, schema) và tài liệu công khai.
2. Spec ghi **hành vi**, không chép code/cấu trúc/comment; file spec lưu kèm ngày và nguồn (như bảng §2).
3. Code mới nằm trong thư mục mới, header license của SimVehicleApp; **xoá hẳn `apps/sim/ee/`** khỏi repo trước khi ship (kể cả lịch sử khi tách repo release).
4. Tên symbol được dùng lại vì nó xuất hiện trong file Apache (là giao diện), không vi phạm.
5. Không dùng tên/logo "Sim Enterprise", không ghi "tương thích Sim Enterprise".
6. Lưu bằng chứng: PR ghi "clean-room, không tham khảo `ee/`", reviewer ký.

## 4. SimVehicleApp cần gì — quyết định theo từng tính năng
| Tính năng | Cần cho SimVehicleApp? | Cách làm | Milestone |
|---|---|---|---|
| whitelabeling | **Có** (34 import; dùng cho branding SimVehicleApp) | Tự viết `brand` đơn giản: config từ env/file, không cần branding theo org ở v1 | M1 |
| access-control `permission-check` | **Có giao diện** (21 import trong luồng execute/API) | v1: implementation "allow-all" theo đúng chữ ký + error classes; P2: policy riêng cho vehicle (ai được SynCode/Run/Export) — gắn EntitlementService (ADR-0031) | M1 (stub) → M11 |
| access-control UI/hooks | Không ở v1 | gỡ call site trang settings | M1 |
| sso | Nên có sớm (backend không phụ thuộc `ee/`) | backend dùng sẵn `@better-auth/sso@1.6.11` (bên thứ ba, MIT, cùng version `better-auth`); chỉ cần `SSO_TRUSTED_PROVIDERS` (mảng tên provider) + tự viết form cấu hình/nút đăng nhập | M11 (gộp cùng audit-logs; không cần đợi M14) |
| audit-logs | Nên có (truy vết SynCode/Run cho ô tô) | API Apache đã có; tự viết trang xem log | M11 |
| data-drains, data-retention | Không | gỡ call site + route UI | M1 |
| `InfoNote`, `SettingRow` | Có | viết lại component UI nhỏ | M1 |

## 5. Cách triển khai trong code (M1)
1. Tạo `apps/sim/lib/sv/oss/` (tên trung tính, không gọi "ee"):
   `brand/`, `access-control/permission-check.ts`, `ui/info-note.tsx`, `ui/setting-row.tsx` (+ `sso/`, `audit-logs/` khi tới milestone).
2. Codemod đổi mọi `@/ee/...` → `@/lib/sv/oss/...` (61 file); call site của tính năng không cần thì xoá.
3. Viết test theo spec §2 (contract test cho `permission-check`: mọi `validate*` trả OK ở chế độ allow-all; error classes là `Error` có `name` đúng).
4. Xoá `apps/sim/ee/`; CI guard: fail nếu tồn tại path `apps/sim/ee` hoặc chuỗi `@/ee/`.
5. `bun run build` + test; ghi kết quả vào report M1.
