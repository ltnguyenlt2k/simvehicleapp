/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMutate, state } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  state: {
    active: undefined as Record<string, unknown> | undefined,
    mine: undefined as Record<string, unknown> | undefined,
  },
}))
vi.mock('@/hooks/queries/sv-runs', () => ({
  useMySvRuns: () => ({ data: state.mine }),
  useStartSvRun: () => ({ mutate: mockMutate, isPending: false }),
  useStopSvRun: () => ({ mutate: mockMutate, isPending: false }),
  useExtendSvRun: () => ({ mutate: mockMutate, isPending: false }),
}))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow', () => ({
  useRunFollow: () => ({ project: { id: 'p1', name: 'LKA' }, active: state.active }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/workspace/ws/w/wf',
  useParams: () => ({}),
}))

import { MyRunsMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/my-runs-menu'
import { RunButtons } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-buttons'

const limits = { sandbox: true, perUser: 2, total: 20, maxMinutes: 30, maxExtensions: 3 }
const run = (extra: Record<string, unknown>) => ({
  id: 'r_1',
  projectId: 'p1',
  projectName: 'LKA',
  workspaceId: 'ws',
  generationId: 'g',
  state: 'running',
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  ...extra,
})

describe('Run with sandboxes (ADR-0057, M17-T05)', () => {
  beforeEach(() => {
    state.active = undefined
    state.mine = undefined
  })

  it('offers Extend in the last minutes of the run, with the time left', () => {
    state.mine = { runs: [], limits }
    state.active = run({ expiresAt: Date.now() + 4 * 60_000, extensions: 0 })
    const html = renderToStaticMarkup(<RunButtons />)
    expect(html).toContain('data-sv-action="extend"')
    expect(html).toContain('Extend (4 min left)')
    expect(html).toContain('stops by itself in 4 min')
  })

  it('no Extend far from the limit, after the last extension, or on the shared stack', () => {
    state.mine = { runs: [], limits }
    state.active = run({ expiresAt: Date.now() + 20 * 60_000 })
    expect(renderToStaticMarkup(<RunButtons />)).not.toContain('data-sv-action="extend"')
    state.active = run({ expiresAt: Date.now() + 60_000, extensions: 3 })
    expect(renderToStaticMarkup(<RunButtons />)).not.toContain('data-sv-action="extend"')
    state.mine = undefined
    state.active = run({})
    expect(renderToStaticMarkup(<RunButtons />)).not.toContain('data-sv-action="extend"')
  })

  it('My runs counts the apps the user runs, and is hidden when none runs', () => {
    expect(renderToStaticMarkup(<MyRunsMenu />)).toBe('')
    state.mine = {
      runs: [run({}), run({ id: 'r_2', projectId: 'p2', projectName: 'ACC' })],
      limits,
    }
    const html = renderToStaticMarkup(<MyRunsMenu />)
    expect(html).toContain('data-sv="my-runs"')
    expect(html).toContain('My runs (2)')
  })
})
