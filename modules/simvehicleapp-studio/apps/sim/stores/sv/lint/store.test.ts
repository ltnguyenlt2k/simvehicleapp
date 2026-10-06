/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { useSvLintStore } from '@/stores/sv/lint/store'

const d = (code: string, severity: SvDiagnostic['severity'], blockId = 'b1'): SvDiagnostic => ({
  code,
  severity,
  stage: 'types',
  blockId,
  message: code,
  docs: `diagnostics#${code}`,
})

describe('lint store: Verify results apply only to the graph they were computed on (M04-T11)', () => {
  beforeEach(() => useSvLintStore.getState().reset())

  it('shows lint, then the verify result, and falls back to lint once the graph changes', () => {
    const s = useSvLintStore.getState()
    s.setGraph('wf', 'g1', [])
    s.setResult('wf', [d('BLOCK_UNREACHABLE', 'warning')])
    expect(useSvLintStore.getState().diagnostics.map((x) => x.code)).toEqual(['BLOCK_UNREACHABLE'])

    s.setVerified('g1', [d('BLOCK_UNREACHABLE', 'warning'), d('TYPE_MISMATCH', 'error')])
    let st = useSvLintStore.getState()
    expect(st.verifiedFresh).toBe(true)
    expect(st.diagnostics.map((x) => x.code)).toEqual(['BLOCK_UNREACHABLE', 'TYPE_MISMATCH'])
    expect(st.byBlock.b1).toMatchObject({ errors: 1, warnings: 1 })

    s.setGraph('wf', 'g2', [])
    st = useSvLintStore.getState()
    expect(st.verifiedFresh).toBe(false)
    expect(st.diagnostics.map((x) => x.code)).toEqual(['BLOCK_UNREACHABLE'])

    s.setGraph('wf', 'g1', [])
    expect(useSvLintStore.getState().verifiedFresh).toBe(true)
  })

  it('adapter issues stay visible next to a verify result; another workflow drops it', () => {
    const s = useSvLintStore.getState()
    const issue = d('CONTAINER_INVALID', 'error', 'loop')
    s.setGraph('wf', 'g1', [issue])
    s.setVerified('g1', [d('TYPE_MISMATCH', 'error')])
    expect(useSvLintStore.getState().diagnostics.map((x) => x.code)).toEqual([
      'CONTAINER_INVALID',
      'TYPE_MISMATCH',
    ])
    s.setGraph('other', 'g1', [])
    expect(useSvLintStore.getState().verified).toBeNull()
  })

  it('showProblems bumps the focus counter', () => {
    const before = useSvLintStore.getState().focusProblems
    useSvLintStore.getState().showProblems()
    expect(useSvLintStore.getState().focusProblems).toBe(before + 1)
  })
})
