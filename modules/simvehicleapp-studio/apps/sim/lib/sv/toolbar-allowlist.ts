import { getEnv } from '@/lib/core/config/env'

/**
 * Block types offered by the toolbar and block search (M01-T05, analysis/11b): only SimVehicleApp
 * blocks (`sv_*`) and the canvas `note`. Sim's own blocks stay registered (existing workflows still
 * load) but are not offered for new use; they are deleted in M11 (ADR-0008 wave 3).
 */
export const DEFAULT_TOOLBAR_ALLOWLIST = 'sv_*,note'

/** Parses a comma-separated list of block-type globs (`*` wildcard only). */
export function parseToolbarAllowlist(value: string | undefined): RegExp[] {
  const raw = value?.trim() ? value : DEFAULT_TOOLBAR_ALLOWLIST
  return raw
    .split(',')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map(
      (pattern) =>
        new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    )
}

/** Patterns from `NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST` (client and server), default {@link DEFAULT_TOOLBAR_ALLOWLIST}. */
export function getToolbarAllowlist(): RegExp[] {
  return parseToolbarAllowlist(getEnv('NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST'))
}

/** True when a block type may be offered in the toolbar and block search. */
export function isToolbarBlockAllowed(
  blockType: string,
  patterns: RegExp[] = getToolbarAllowlist()
): boolean {
  return patterns.some((pattern) => pattern.test(blockType))
}
