/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { buildSelectorContextFromBlock, SELECTOR_CONTEXT_FIELDS } from './context'

describe('buildSelectorContextFromBlock', () => {
  it('should extract knowledgeBaseId from knowledgeBaseSelector via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: 'kb-uuid-123',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('kb-uuid-123')
  })

  it('should extract knowledgeBaseId from manualKnowledgeBaseId via canonical mapping', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      manualKnowledgeBaseId: {
        id: 'manualKnowledgeBaseId',
        type: 'short-input',
        value: 'manual-kb-id',
      },
    })

    expect(ctx.knowledgeBaseId).toBe('manual-kb-id')
  })

  it('should skip null/empty values', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      knowledgeBaseSelector: {
        id: 'knowledgeBaseSelector',
        type: 'knowledge-base-selector',
        value: '',
      },
    })

    expect(ctx.knowledgeBaseId).toBeUndefined()
  })

  it('should return empty context for unknown block types', () => {
    const ctx = buildSelectorContextFromBlock('nonexistent_block', {
      foo: { id: 'foo', type: 'short-input', value: 'bar' },
    })

    expect(ctx).toEqual({})
  })

  it('should pass through workflowId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workflowId: 'wf-123' }
    )

    expect(ctx.workflowId).toBe('wf-123')
  })

  it('should pass through workspaceId from opts', () => {
    const ctx = buildSelectorContextFromBlock(
      'knowledge',
      { operation: { id: 'operation', type: 'dropdown', value: 'search' } },
      { workspaceId: 'ws-123' }
    )

    expect(ctx.workspaceId).toBe('ws-123')
  })

  it('should ignore subblock keys not in SELECTOR_CONTEXT_FIELDS', () => {
    const ctx = buildSelectorContextFromBlock('knowledge', {
      operation: { id: 'operation', type: 'dropdown', value: 'search' },
      query: { id: 'query', type: 'short-input', value: 'some search query' },
    })

    expect((ctx as Record<string, unknown>).query).toBeUndefined()
    expect((ctx as Record<string, unknown>).operation).toBeUndefined()
  })
})
