/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('@sim/db/schema', () => ({ svWorkflowTestCases: {} }))

import { scenariosForSynCode } from '@/lib/sv/server/test-cases'

const sc = (name: string) => ({ scenarioVersion: '1.0.0' as const, name, until: 1, inputs: [] })

describe('test cases ⇒ SynCode scenarios (ADR-0058 §2)', () => {
  it('a lone case is sent without a name (the generated test stays as before); several get their names', () => {
    const cases = new Map([
      ['wf-a', [{ id: 'tc_1', name: 'Default', scenario: sc('a'), position: 0 }]],
      [
        'wf-b',
        [
          { id: 'tc_2', name: 'Above', scenario: sc('b1'), position: 0 },
          { id: 'tc_3', name: 'Below', scenario: sc('b2'), position: 1 },
        ],
      ],
    ])
    expect(scenariosForSynCode(cases)).toEqual([
      { workflowId: 'wf-a', scenario: sc('a') },
      { workflowId: 'wf-b', scenario: sc('b1'), caseName: 'Above' },
      { workflowId: 'wf-b', scenario: sc('b2'), caseName: 'Below' },
    ])
  })
})
