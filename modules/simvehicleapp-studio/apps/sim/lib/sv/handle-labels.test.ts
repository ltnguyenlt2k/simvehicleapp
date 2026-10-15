import { describe, expect, it } from 'vitest'
import { SV_HANDLE_BG, SV_HANDLE_COLOR, svEdgeLabel, svHandleTone } from '@/lib/sv/handle-labels'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

const SPECS = (specsSnapshot as { blocks: { type: string; handles: { out: string[] } }[] }).blocks

describe('branch handle tones (ADR-0055)', () => {
  it('outcomes read the same everywhere', () => {
    expect(svHandleTone('then')).toBe('positive')
    expect(svHandleTone('stable')).toBe('positive')
    expect(svHandleTone('case-2')).toBe('positive')
    expect(svHandleTone('else')).toBe('negative')
    expect(svHandleTone('broken')).toBe('warning')
    expect(svHandleTone('timeout')).toBe('warning')
    expect(svHandleTone('error')).toBe('error')
    expect(svHandleTone('source')).toBe('neutral')
    expect(svHandleTone(undefined)).toBe('neutral')
  })

  it('every named branch of a BlockSpec has a tone other than neutral', () => {
    const plain = new Set([
      'source',
      'case',
      'loop-start-source',
      'loop-end-source',
      'parallel-start-source',
      'parallel-end-source',
    ])
    for (const s of SPECS)
      for (const h of s.handles.out.filter((h) => !plain.has(h)))
        expect(svHandleTone(h), `${s.type}:${h}`).not.toBe('neutral')
  })

  it('every tone has a colour and a handle class', () => {
    for (const tone of ['positive', 'negative', 'warning', 'error', 'neutral'] as const) {
      expect(SV_HANDLE_COLOR[tone]).toMatch(/^var\(--/)
      expect(SV_HANDLE_BG[tone]).toMatch(/^!bg-\[var\(--/)
    }
  })

  it('edges of named branches are labelled; sequence edges are not', () => {
    expect(svEdgeLabel('stable')).toBe('stable')
    expect(svEdgeLabel('ok')).toBe('in time')
    expect(svEdgeLabel('case-0')).toBe('case 1')
    expect(svEdgeLabel('error')).toBe('on error')
    expect(svEdgeLabel('source')).toBeNull()
    expect(svEdgeLabel('condition-abc')).toBeNull()
    expect(svEdgeLabel(null)).toBeNull()
  })
})
