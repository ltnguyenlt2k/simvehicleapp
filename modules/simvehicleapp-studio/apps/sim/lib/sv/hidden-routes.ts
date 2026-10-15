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

/**
 * `home` and `chat` were the copilot (Mothership) chat, removed in M01-T03; Sim still links to them in many places.
 * Tables, Files, Knowledge base, Logs and Scheduled tasks serve AI agents, not the vehicle toolchain: hidden in M16-T07 (ADR-0054
 * §Focus) — by configuration only, the pages stay in the tree to keep the upstream diff small.
 */
const HIDDEN_WORKSPACE_SECTIONS = [
  'chat',
  'files',
  'home',
  'integrations',
  'knowledge',
  'logs',
  'scheduled-tasks',
  'skills',
  'tables',
  'upgrade',
] as const

/** Sections a sidebar or search may link to; nothing else of the workspace is offered (ADR-0054 §Focus). */
export function isHiddenWorkspaceSection(section: string): boolean {
  return (HIDDEN_WORKSPACE_SECTIONS as readonly string[]).includes(section)
}

/**
 * Settings the vehicle toolchain uses (ADR-0054 §Focus, M16-T07): an allowlist, so a section Sim adds later stays
 * hidden until it is reviewed. Billing, custom tools, MCP tools/servers, API keys, BYOK and email polling serve AI
 * agents (the vehicle MCP server is configured in `.env`, not here).
 */
const SETTINGS_SECTIONS = [
  'general',
  'teammates',
  'organization',
  'secrets',
  'recently-deleted',
  'admin',
] as const

/** A Settings section that is not offered. */
export function isHiddenSettingsSection(section: string): boolean {
  return !(SETTINGS_SECTIONS as readonly string[]).includes(section)
}

const WORKSPACE_SECTION = /^\/workspace\/([^/]+)\/([^/]+)(?:\/.*)?$/
const SETTINGS_SECTION = /^\/workspace\/([^/]+)\/settings\/([^/]+)(?:\/.*)?$/

/** Target path for a hidden route, or `null` when the route stays available. */
export function getHiddenRouteRedirect(pathname: string): string | null {
  const settings = SETTINGS_SECTION.exec(pathname)
  if (settings && isHiddenSettingsSection(settings[2]))
    return `/workspace/${settings[1]}/settings/general`
  const workspace = WORKSPACE_SECTION.exec(pathname)
  if (workspace) {
    const [, workspaceId, section] = workspace
    return isHiddenWorkspaceSection(section) ? `/workspace/${workspaceId}/w` : null
  }
  const hidden = HIDDEN_SITE_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}.`)
  )
  return hidden ? '/' : null
}
