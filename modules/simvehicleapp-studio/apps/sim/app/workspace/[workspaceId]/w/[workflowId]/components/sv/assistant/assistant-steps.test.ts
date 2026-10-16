/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  elapsedLabel,
  toolLabel,
  toolStepState,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/assistant/assistant-steps'

describe('assistant steps (M17-T06)', () => {
  it('labels known tools in words; an unknown tool shows its name', () => {
    expect(toolLabel('vss_search')).toBe('Searching vehicle signals')
    expect(toolLabel('workflow_propose_patch')).toBe('Preparing a change to the workflow')
    expect(toolLabel('mcp_external_thing')).toBe('mcp_external_thing')
  })

  it('a step runs until its result: ✓ done, ✕ failed, stopped when the turn ended first', () => {
    expect(toolStepState({}, true)).toBe('running')
    expect(toolStepState({ done: true }, true)).toBe('done')
    expect(toolStepState({ done: true, isError: true }, false)).toBe('failed')
    expect(toolStepState({}, false)).toBe('stopped')
  })

  it('elapsed time in seconds, then minutes', () => {
    expect(elapsedLabel(4_900)).toBe('4 s')
    expect(elapsedLabel(65_000)).toBe('1 min 05 s')
    expect(elapsedLabel(-5)).toBe('0 s')
  })
})
