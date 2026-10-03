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
    '/workspace/ws1/files',
    '/workspace/ws1/settings/general',
    '/blogger',
    '/modelsx',
    '/chat/abc',
  ])('%s stays available', (path) => {
    expect(getHiddenRouteRedirect(path)).toBeNull()
  })
})
