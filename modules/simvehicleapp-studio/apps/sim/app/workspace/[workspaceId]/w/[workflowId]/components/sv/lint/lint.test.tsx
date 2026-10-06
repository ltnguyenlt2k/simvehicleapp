/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { ProblemsList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/lint/problems-panel'
import { summarizeByBlock } from '@/stores/sv/lint/store'

vi.mock('@/hooks/queries/sv-catalog', () => ({}))
vi.mock('@/hooks/queries/sv-lint', () => ({}))
vi.mock('@/hooks/queries/workflows', () => ({}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release',
  () => ({})
)

import { issueToDiagnostic } from '@/lib/sv/graph-adapter'

const d = (
  code: string,
  severity: SvDiagnostic['severity'],
  blockId?: string,
  message = code
): SvDiagnostic => ({
  code,
  severity,
  stage: 'block-config',
  ...(blockId ? { blockId } : {}),
  message,
  docs: `diagnostics#${code}`,
})

describe('lint store summary (M03-T11)', () => {
  it('counts per block and keeps the most severe message first', () => {
    expect(
      summarizeByBlock([
        d('BLOCK_UNREACHABLE', 'warning', 'b1', 'never runs'),
        d('EXPR_SYNTAX', 'error', 'b1', 'bad expression'),
        d('POLLING_PREFER_SUBSCRIPTION', 'info', 'b2'),
        d('GRAPH_SCHEMA_INVALID', 'error'),
      ])
    ).toEqual({
      b1: { errors: 1, warnings: 1, infos: 0, first: 'bad expression' },
      b2: { errors: 0, warnings: 0, infos: 1, first: 'POLLING_PREFER_SUBSCRIPTION' },
    })
  })

  it('turns adapter issues into catalog diagnostics', () => {
    expect(
      issueToDiagnostic({ code: 'CONTAINER_INVALID', blockId: 'p1', message: 'x' }, 'wf')
    ).toEqual({
      code: 'CONTAINER_INVALID',
      severity: 'error',
      stage: 'structural',
      workflowId: 'wf',
      blockId: 'p1',
      message: 'x',
      docs: 'diagnostics#CONTAINER_INVALID',
    })
  })
})

describe('Problems list', () => {
  it('shows counts, block names and codes', () => {
    const html = renderToStaticMarkup(
      <ProblemsList
        diagnostics={[
          d('EXPR_SYNTAX', 'error', 'b1', 'Unexpected end'),
          d('BLOCK_UNREACHABLE', 'warning', 'b2', 'Never runs'),
        ]}
        status='ok'
        blockName={(id) => (id === 'b1' ? 'Check speed' : undefined)}
        onSelect={() => {}}
      />
    )
    expect(html).toContain('1 error, 1 warning')
    expect(html).toContain('Check speed: </span>Unexpected end')
    expect(html).toContain('data-sv-problem="BLOCK_UNREACHABLE"')
  })

  it('reports an empty result, a running check and an outage', () => {
    const render = (status: 'ok' | 'checking' | 'unavailable') =>
      renderToStaticMarkup(
        <ProblemsList diagnostics={[]} status={status} blockName={() => undefined} />
      )
    expect(render('ok')).toContain('No problems')
    expect(render('checking')).toContain('Checking…')
    expect(render('unavailable')).toContain('Checks unavailable')
  })

  it('labels a Verify result and offers the quick-fix button (M04-T11)', () => {
    const html = renderToStaticMarkup(
      <ProblemsList
        diagnostics={[d('TYPE_NARROWING_REQUIRES_CAST', 'error', 'b1', 'May not fit uint8')]}
        status='checking'
        verified
        blockName={() => 'Set fan'}
        onSelect={() => {}}
        fixFor={(x) =>
          x.code === 'TYPE_NARROWING_REQUIRES_CAST'
            ? { label: 'Insert Convert to uint8', run: () => {} }
            : undefined
        }
      />
    )
    expect(html).toContain('Verified · 1 error, 0 warnings')
    expect(html).toContain('data-sv-fix="TYPE_NARROWING_REQUIRES_CAST"')
    expect(html).toContain('Insert Convert to uint8')
  })

  it('infos are notes, not problems', () => {
    const html = renderToStaticMarkup(
      <ProblemsList
        diagnostics={[d('UNIT_ASSUMED', 'info', 'b1', '120 is read as km/h')]}
        status='ok'
        verified
        blockName={() => undefined}
      />
    )
    expect(html).toContain('Verified · No problems (1 note)')
  })
})
