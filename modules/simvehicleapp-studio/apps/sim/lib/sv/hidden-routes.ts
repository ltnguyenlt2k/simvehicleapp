/**
 * Sim routes that SimVehicleApp does not offer (M01-T05, ADR-0008): marketing/landing pages,
 * the integrations and skills catalogs, and billing upgrade. Requests are redirected instead of
 * deleting the pages now; the files are removed in M11 (ADR-0008 wave 3).
 * `/terms` and `/privacy` stay reachable (linked from the auth pages) until the rebrand (M01-T06).
 */
const HIDDEN_SITE_PREFIXES = [
  '/academy',
  '/blog',
  '/changelog',
  '/contact',
  '/integrations',
  '/models',
  '/partners',
  '/playground',
] as const

/** `home` and `chat` were the copilot (Mothership) chat, removed in M01-T03; Sim still links to them in many places. */
const HIDDEN_WORKSPACE_SECTIONS = ['chat', 'home', 'integrations', 'skills', 'upgrade'] as const

const WORKSPACE_SECTION = /^\/workspace\/([^/]+)\/([^/]+)(?:\/.*)?$/

/** Target path for a hidden route, or `null` when the route stays available. */
export function getHiddenRouteRedirect(pathname: string): string | null {
  const workspace = WORKSPACE_SECTION.exec(pathname)
  if (workspace) {
    const [, workspaceId, section] = workspace
    return (HIDDEN_WORKSPACE_SECTIONS as readonly string[]).includes(section)
      ? `/workspace/${workspaceId}/w`
      : null
  }
  const hidden = HIDDEN_SITE_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}.`)
  )
  return hidden ? '/' : null
}
