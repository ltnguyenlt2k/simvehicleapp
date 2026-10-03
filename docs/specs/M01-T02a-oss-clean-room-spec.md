# Spec clean-room thay thế `apps/sim/ee/` — `lib/sv/oss/*` (M01-T02a)

- **Ngày:** 2026-10-03 · **Tác giả spec:** Claude Code · **ADR:** 0004 (Accepted), 0008 · **Phân tích:** [11a](../../analysis/11a-ee-clean-room-replacement.md)
- **Baseline:** Sim v0.7.13 `ad0b8678…` (snapshot `modules/simvehicleapp-studio`, tag `studio/baseline-v0.7.13`)

## 0. Tuyên bố clean-room
Spec này **chỉ** được suy ra từ phần Apache-2.0 của Sim: câu lệnh `import` và call site trong 61 file ngoài `apps/sim/ee/`,
API route Apache, `lib/permission-groups/types.ts`, `app/_styles/globals.css`. **Không** mở, đọc, grep nội dung, chép code, cấu trúc
hay comment của bất kỳ file nào dưới `apps/sim/ee/`. Mọi lệnh tìm kiếm đều loại trừ `apps/sim/ee/` (`grep … | grep -v "^apps/sim/ee/"`).
Tên symbol được giữ vì chúng là giao diện xuất hiện trong file Apache (11a §3.4). Người implement T02b chỉ đọc spec này + file Apache.

Lệnh thu thập (tái lập được):
```bash
cd modules/simvehicleapp-studio
grep -rn --include=*.ts --include=*.tsx -E "from '@/ee/[^']+'" apps packages | grep -v "^apps/sim/ee/"      # 62 import / 61 file
grep -rn --include=*.ts --include=*.tsx -E "import\(['\"]@/ee/" apps | grep -v "^apps/sim/ee/"             # 8 import động / 3 file
```

## 1. Kiểm kê thực tế (đính chính 11a §2)
| Module `@/ee/…` | Import tĩnh | Import động | Quyết định v1 |
|---|---|---|---|
| `whitelabeling` (+ `/org-branding`, `/components/branding-provider`) | 36 | 1 (`lib/billing/core/subscription.ts`) | **Viết lại** → `lib/sv/oss/brand` |
| `access-control/utils/permission-check` | 21 | 1 (`lib/copilot/chat/payload.ts`) | **Viết lại allow-all** → `lib/sv/oss/access-control/permission-check` |
| `access-control/hooks/permission-groups` | 1 (`hooks/use-permission-config.ts`) | — | **Viết lại** `useUserPermissionConfig` (allow-all) |
| `sso/{constants,hooks/sso,components/sso-form,components/sso-auth}` | 4 | 1 (settings) | `SSO_TRUSTED_PROVIDERS = []`; gỡ call site UI tới M11 |
| `access-control/components`, `audit-logs`, `data-retention`, `data-drains`, `whitelabeling/components/whitelabeling-settings` | 0 | 5 (đều trong `app/workspace/[workspaceId]/settings/[section]/settings.tsx`) | **Gỡ section settings** (T02c) |

Đính chính so với 11a: `InfoNote`, `SettingRow`, hooks audit-logs/data-drains/data-retention, `mergeOrgBrandConfig`, `generateOrgThemeCSS`,
`useWhitelabelSettings`, `useUpdateWhitelabelSettings`, `WhitelabelSettingsPayload`, `usePermissionGroups`, `useConfigureSSO`,
`PermissionGroup` **không** được file Apache nào import (chỉ dùng nội bộ `ee/`) ⇒ không cần viết lại.

## 2. `lib/sv/oss/brand` (thay `@/ee/whitelabeling`)
### 2.1 Kiểu `BrandConfig` — các field mà file Apache thực sự đọc
| Field | Kiểu | Dùng ở (ví dụ) | Giá trị SimVehicleApp |
|---|---|---|---|
| `name` | `string` | title metadata, email subject/preview (`otp-verification-email.tsx`), A2A agent card, `subscription.ts`; `branded-layout.tsx` so sánh `!== 'Sim'` | env `SV_BRAND_NAME` ?? `"SimVehicleApp"` |
| `supportEmail` | `string` | `mailto:` ở auth `support-footer`, email layout, settings | env `SV_SUPPORT_EMAIL` ?? `"support@simvehicleapp.local"` (placeholder, PO thay) |
| `logoUrl` | `string \| undefined` | navbar/auth-modal (`brand.logoUrl ? … : '/logo/sim-landing.svg'`), settings avatar fallback | `undefined` ⇒ dùng asset đã thay tại chỗ (M01-T06) |
| `faviconUrl` | `string \| undefined` | `branded-layout.tsx` ghi đè favicon khi có | `undefined` |
| `customCssUrl` | `string \| undefined` | `branded-layout.tsx` chèn `<link>` khi có | `undefined` |
| `theme` | `{ primaryColor?: string, … } \| undefined` | manifest `theme_color`, email layout: `isWhitelabeled && theme?.primaryColor ? … : '#33C482'` | `{ primaryColor: "#0FC0FF" }` (median màu mark, `brand/README.md`) |
| `isWhitelabeled` | `boolean` | 2 chỗ (manifest, email) bật màu theme thay `#33C482` | `true` (SimVehicleApp là bản rebrand) |

Field khác của kiểu: tuỳ ý, nhưng không file Apache nào phụ thuộc.

### 2.2 Hàm/hook/component
| Symbol | Chữ ký suy từ call site | Hành vi v1 |
|---|---|---|
| `getBrandConfig()` | `() => BrandConfig`, đồng bộ, gọi được cả server lẫn client, kể cả `(await import(...)).getBrandConfig().name` | Trả object cố định đọc env (2.1); tất định |
| `useBrandConfig()` | hook client `() => BrandConfig` (5 file) | Trả cùng giá trị `getBrandConfig()` (không cần org-branding v1) |
| `generateBrandedMetadata()` | `() => Metadata` (Next.js), dùng `export const metadata = generateBrandedMetadata()` ở `app/layout.tsx` | `title: { default: name, template: "%s | " + name }`, `description` (env `SV_BRAND_DESCRIPTION` ?? "Model · Build · Run — for real vehicles"), `applicationName: name`, `icons` trỏ `/icon.svg`, `/favicon/*`, `/favicon/apple-touch-icon.png`; không URL `sim.ai` |
| `generateThemeCSS()` | `() => string` (falsy ⇒ không chèn); `app/layout.tsx` chèn qua `<style dangerouslySetInnerHTML>` | Trả `:root,.dark{--brand-accent:#0FC0FF;--brand-accent-hover:#0AA3DB}` (ghi đè biến có thật trong `globals.css`: `--brand-accent #33c482`, `--brand-accent-hover #2dac72`); chuỗi rỗng nếu `theme.primaryColor` không có |
| `getOrgWhitelabelSettings(orgId)` | `(orgId: string) => Promise<OrgSettings \| null>` (`app/workspace/[workspaceId]/layout.tsx`) | Luôn `null` (không branding theo organization ở v1, 11a §4) |
| `BrandingProvider` | `({ initialOrgSettings, children }) => JSX` | Render `children` nguyên vẹn |

## 3. `lib/sv/oss/access-control/permission-check` (allow-all, thay `@/ee/access-control/utils/permission-check`)
Nguyên tắc: **mọi kiểm tra cho phép**; v1 không có permission group. Policy riêng cho vehicle (SynCode/Run/Export) thuộc EntitlementService (ADR-0031, M11), không đặt ở đây.

| Symbol | Chữ ký suy từ call site | Hành vi v1 |
|---|---|---|
| `getUserPermissionConfig(userId, workspaceId)` | `(string, string) => Promise<PermissionGroupConfig \| null>`; caller dùng `config?.allowedIntegrations ?? getAllowedIntegrationsFromEnv()` | `null` ⇒ caller giữ allowlist env có sẵn |
| `resolveWorkspaceGroup(userId, organizationId, workspaceId)` | `=> Promise<{ permissionGroupId, groupName, config } \| null>` (route `api/permission-groups/user`) | `null` |
| `assertPermissionsAllowed(opts)` | `opts: { userId: string; workspaceId: string; model?: string; toolKind?: 'skill' \| 'custom' \| 'mcp'; ctx?: ExecutionContext }` ⇒ `Promise<void>`, ném lỗi khi bị chặn | resolve, không ném |
| `validateBlockType(userId, workspaceId, blockType, ctx?)` | `=> Promise<void>` | resolve |
| `validateModelProvider(userId, workspaceId, model, ctx?)` | `=> Promise<void>` | resolve |
| `validateMcpToolsAllowed` / `validateCustomToolsAllowed` / `validateSkillsAllowed` `(userId, workspaceId, ctx?)` | `=> Promise<void>` | resolve |
| `validateInvitationsAllowed(userId, scope)` | `scope: string (workspaceId) \| { organizationId: string }` ⇒ `Promise<void>` | resolve |
| `validatePublicApiAllowed(userId?, workspaceId?)` | tham số có thể `undefined` (deploy route) ⇒ `Promise<void>` | resolve |
| `validatePublicFileSharing(userId, workspaceId, authType)` | `authType: ShareAuthType` (`lib/permission-groups/types.ts`) ⇒ `Promise<void>` | resolve |

`userId`/`workspaceId` ở các `validate*` có thể là `undefined` ở vài call site ⇒ khai báo `string | undefined`.

**Error classes** (caller chỉ dùng `instanceof` + `.message`): `IntegrationNotAllowedError`, `InvitationsNotAllowedError`,
`McpToolsNotAllowedError`, `ModelNotAllowedError`, `ProviderNotAllowedError`, `PublicApiNotAllowedError`,
`PublicFileSharingNotAllowedError` — mỗi lớp `extends Error`, `name` = tên lớp, constructor `(message?: string)` với message mặc định
mô tả ngắn bằng tiếng Anh. Allow-all không ném nhưng lớp phải tồn tại để `instanceof` trong route biên dịch và đúng ngữ nghĩa.

## 4. `lib/sv/oss/access-control/hooks` — `useUserPermissionConfig(workspaceId?)`
Caller (`hooks/use-permission-config.ts`) đọc `{ data, isLoading }`, với `data?.config` và `data?.permissionGroupId`; `data` có
hình dạng giống response của route Apache `GET /api/permission-groups/user`
(`{ permissionGroupId, groupName, config, entitled, organizationId, isOrgAdmin }`).
v1: trả `{ data: { permissionGroupId: null, groupName: null, config: null, entitled: true, organizationId: null, isOrgAdmin: false }, isLoading: false }`,
không gọi mạng ⇒ caller rơi về `DEFAULT_PERMISSION_GROUP_CONFIG` (đã có trong Apache).

## 5. SSO (`@/ee/sso/*`)
- `SSO_TRUSTED_PROVIDERS`: `readonly string[]`, dùng ở `lib/auth/auth.ts` (`.includes(providerId)`, spread vào danh sách trusted providers cùng `additionalTrustedSsoProviders`). v1: `[]` tại `lib/sv/oss/sso/constants.ts` — backend `@better-auth/sso` (MIT) giữ nguyên, chỉ không có provider tin cậy mặc định.
- `SSOForm` (`app/(auth)/sso/page.tsx`), `SSOAuth` (`app/chat/[identifier]/chat.tsx`, nhánh chat bảo vệ bằng SSO), `useSSOProviders({ enabled })` (`settings-sidebar.tsx`): **gỡ call site** ở T02c (trang `/sso` → redirect `/login`; nhánh SSO của chat → thông báo "SSO not available"; mục SSO trong sidebar settings ẩn). Viết lại UI ở M11 (ADR-0032).

## 6. Settings sections gỡ ở T02c
`settings.tsx` import động 6 component `ee`: AccessControl, AuditLogs, SSO, DataRetentionSettings, DataDrainsSettings,
WhitelabelingSettings ⇒ xoá các `dynamic()` này và mục điều hướng tương ứng (đánh dấu `// SV:`).

## 7. Contract test (T02b)
1. `getBrandConfig()` trả đúng giá trị mặc định §2.1 và nhận override env; gọi 2 lần ra object bằng nhau (tất định).
2. `generateBrandedMetadata().title` dùng template `%s | SimVehicleApp`; không chứa chuỗi `sim.ai`.
3. `generateThemeCSS()` chứa `--brand-accent:#0FC0FF`; rỗng khi không có `primaryColor`.
4. Mọi `validate*` và `assertPermissionsAllowed` resolve `undefined` với tham số đầy đủ lẫn `undefined`; `getUserPermissionConfig`/`resolveWorkspaceGroup` trả `null`.
5. Mỗi error class: `new X() instanceof Error`, `instanceof X`, `.name === "X"`.
6. Guard (T02c/T11): sau codemod không còn chuỗi `@/ee/` và không còn đường dẫn `apps/sim/ee` (CI).
