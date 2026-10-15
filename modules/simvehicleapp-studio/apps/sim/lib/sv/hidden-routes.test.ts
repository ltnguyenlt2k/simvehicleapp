/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getHiddenRouteRedirect } from '@/lib/sv/hidden-routes'

describe('hidden routes (M01-T05)', () => {
  it.each([
    ['/workspace/ws1/integrations', '/workspace/ws1/w'],
    ['/workspace/ws1/integrations/slack', '/workspace/ws1/w'],
    ['/workspace/ws1/skills', '/workspace/ws1/w'],
    ['/workspace/ws1/upgrade', '/workspace/ws1/w'],
    ['/workspace/ws1/home', '/workspace/ws1/w'],
    ['/workspace/ws1/chat/abc', '/workspace/ws1/w'],
    ['/workspace/ws1/tables', '/workspace/ws1/w'],
    ['/workspace/ws1/tables/t1', '/workspace/ws1/w'],
    ['/workspace/ws1/files', '/workspace/ws1/w'],
    ['/workspace/ws1/files/f1/view', '/workspace/ws1/w'],
    ['/workspace/ws1/knowledge', '/workspace/ws1/w'],
    ['/workspace/ws1/knowledge/kb1', '/workspace/ws1/w'],
    ['/workspace/ws1/logs', '/workspace/ws1/w'],
    ['/workspace/ws1/scheduled-tasks', '/workspace/ws1/w'],
    ['/workspace/ws1/settings/billing', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/custom-tools', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/mcp', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/apikeys', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/workflow-mcp-servers', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/byok', '/workspace/ws1/settings/general'],
    ['/workspace/ws1/settings/credential-sets', '/workspace/ws1/settings/general'],
    ['/blog', '/'],
    ['/blog/copilot', '/'],
    ['/integrations/slack', '/'],
    ['/models', '/'],
    ['/changelog.xml', '/'],
    ['/academy/intro/lesson-1', '/'],
    ['/playground', '/'],
  ])('%s -> %s', (path, target) => {
    expect(getHiddenRouteRedirect(path)).toBe(target)
  })

  it.each([
    '/',
    '/login',
    '/signup',
    '/terms',
    '/privacy',
    '/workspace',
    '/workspace/ws1',
    '/workspace/ws1/w',
    '/workspace/ws1/w/wf1',
    '/workspace/ws1/vehicle-projects',
    '/workspace/ws1/system-status',
    '/workspace/ws1/settings/general',
    '/workspace/ws1/settings/teammates',
    '/workspace/ws1/settings/organization',
    '/workspace/ws1/settings/secrets',
    '/workspace/ws1/settings/recently-deleted',
    '/workspace/ws1/settings/admin',
    '/workspace/ws1/settings',
    '/blogger',
    '/modelsx',
    '/chat/abc',
  ])('%s stays available', (path) => {
    expect(getHiddenRouteRedirect(path)).toBeNull()
  })
})
