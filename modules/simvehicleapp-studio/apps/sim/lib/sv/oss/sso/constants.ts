/**
 * Provider ids trusted for SSO account linking by `lib/auth/auth.ts`. Empty in v1: the
 * `@better-auth/sso` backend stays available, configuration UI arrives in M11 (ADR-0032).
 */
export const SSO_TRUSTED_PROVIDERS: readonly string[] = []
