# ADR-0032: Auth & tenancy

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** NFR-04, Q1; Master Plan 12.3

## Decision
1. Giữ **Better Auth** của Sim (email/password; OAuth tuỳ chọn), pin đúng version Sim đang dùng: `better-auth@1.6.11`. **SSO backend không nằm trong `ee/`** — đã verify: `apps/sim/lib/auth/auth.ts` dùng plugin bên thứ ba `@better-auth/sso@1.6.11` (MIT, cùng version `better-auth`), import duy nhất `SSO_TRUSTED_PROVIDERS` (một mảng tên provider) từ `@/ee/sso/constants`; DB schema `sso_provider` cũng đã có sẵn trong `packages/db/schema.ts` (Apache). Chỉ **UI cấu hình/đăng nhập SSO** (`ee/sso/components/*`) cần viết lại clean-room theo [11a](../11a-ee-clean-room-replacement.md) — việc này không cần ADR riêng và không cần đợi tới M14 như bản cũ ghi nhầm — có thể làm bất cứ lúc nào, khuyến nghị gộp cùng M11 (cùng dạng "viết UI mỏng trên API/backend Apache đã có" như audit-logs). SCIM (provisioning tự động) thật sự chưa có backend sẵn ⇒ vẫn hoãn, cần ADR riêng khi cần.
2. `DISABLE_AUTH=true` chỉ cho local single-user; bootstrap cảnh báo nếu bind không phải localhost.
3. Tenancy v1: workspace Sim = team; project SimVehicleApp thuộc workspace; BFF kiểm tra quyền (owner/editor/viewer) trước mọi route `/api/sv/*`.
4. Runtime stack dùng chung cả instance (1 run active) — v1 phù hợp team nhỏ. Multi-user thật (per-run stack, per-user workspace volume) ⇒ ADR-0046 (M14).
5. Service nội bộ xác thực bằng `INTERNAL_API_SECRET` + network internal; ai-assistant nhận `userId` từ BFF (không tự xác thực browser).

## Verification
Test phân quyền BFF (viewer không SynCode/Run); pen-test cơ bản route nội bộ không truy cập được từ host; SSO login round-trip (OIDC) với provider test.

## Notes / Deviations (2026-10-01)
Sửa mâu thuẫn với [11a-ee-clean-room-replacement.md §4](../11a-ee-clean-room-replacement.md) (tài liệu đó đã ghi đúng "backend dùng sẵn @better-auth/sso" nhưng ADR này trước đó lại ghi sai là "SSO nằm trong ee/ ⇒ bị gỡ"). Cũng xác nhận `audit_log` table đã có sẵn trong Apache core schema (`packages/db/schema.ts:2745`), củng cố kế hoạch M11 "audit-logs: API Apache đã có, chỉ cần viết UI" ở 11a — không cần backend mới.

## Notes / Deviations (2026-10-07) — nâng better-auth 1.6.11 → 1.6.33 (M11-T03 đợt 3b), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- Lý do: osv-scanner báo 2 lỗ hổng của `better-auth` 1.6.11 (sửa từ 1.6.22). Chọn bản vá mới nhất của nhánh 1.6 đã
  ghim (1.6.33, phát hành 2026-09-14 — qua `minimumReleaseAge` 7 ngày của fork); `@better-auth/sso` và
  `@better-auth/stripe` cùng phiên bản. Không đổi minor ⇒ Decision §1 giữ nguyên ý (Better Auth của Sim, SSO plugin MIT).
- Kiểm: type-check studio sạch, 8 446 test vitest pass; E2E CI (sign-up có 429 + `X-Retry-After`) chạy trên image mới.
