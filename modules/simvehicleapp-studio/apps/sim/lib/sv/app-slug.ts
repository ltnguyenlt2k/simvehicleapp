/** Folder name rule of a vehicle app (`/workspace/projects/<slug>`), as the orchestrator checks it. */
export const SV_APP_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/** Folder name of a vehicle app from its name (`My Vehicle App` → `my-vehicle-app`, `Đèn cảnh báo` → `den-canh-bao`). */
export function appSlugOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

/**
 * A folder name for `name` not in `taken`: `hazard-app`, else `hazard-app-2`, `-3`… A name with no letter or digit
 * falls back to `vehicle-app`. Folder names are unique on the host, so a clash with another workspace's app is still
 * possible: the caller retries with {@link appSlugWithSuffix}.
 */
export function freeAppSlug(name: string, taken: Iterable<string>): string {
  const base = appSlugOf(name) || 'vehicle-app'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, 63 - `-${i}`.length)}-${i}`
    if (!used.has(candidate)) return candidate
  }
}

/** `base` with a short suffix (`hazard-app-k3x9`), for a folder name another workspace already uses. */
export function appSlugWithSuffix(base: string, suffix: string): string {
  const tail = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 6)
  return `${base.slice(0, 62 - tail.length)}-${tail}`
}
