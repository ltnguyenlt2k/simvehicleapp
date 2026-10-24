/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FlowTraceEvent } from '@/lib/sv/flow-trace'
import { FlowPanel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/flow-panel'

const GOLDEN = join(
  __dirname,
  '../../../../../../../../../../../simvehicleapp-contracts/fixtures/golden'
)
const trace = JSON.parse(
  readFileSync(join(GOLDEN, 'GW-A', 'expected.trace.json'), 'utf8')
) as FlowTraceEvent[]
const names: Record<string, string> = {}

describe('Flow view (M19-T04)', () => {
  it('lists the runs newest first; the newest is open with branch, operands, writes and what fired it', () => {
    const html = renderToStaticMarkup(
      <FlowPanel
        trace={trace}
        signals={[{ path: 'Vehicle.Speed', ts: 6000, value: 105, source: 'scenario' }]}
        blockName={(id) => names[id]}
        emptyText='none'
        downloadName='f.jsonl'
      />
    )
    const runs = [...html.matchAll(/data-sv-flow-run="(\d+)" data-sv-outcome="(\w+)"/g)].map(
      (m) => `${m[1]}:${m[2]}`
    )
    expect(runs).toEqual(['5:done', '4:done', '3:done', '2:cancelled', '1:done'])
    expect(html).toContain('Vehicle.Speed = 105 (scenario input)')
    expect(html).toContain('5 runs')
    // only the newest run is expanded: its write shows, run 3's stable branch does not
    expect(html).toContain('data-sv-flow-write="Vehicle.Body.Lights.Hazard.IsSignaling"')
    expect(html).not.toContain('data-sv-flow-handle="stable"')
  })

  it('in Simulate the run at the replay cursor is open and highlighted', () => {
    const html = renderToStaticMarkup(
      <FlowPanel trace={trace} activeAt={4000} emptyText='none' downloadName='f.jsonl' />
    )
    expect(html).toContain('data-sv-flow-handle="stable"')
    expect(html).toContain('n1.value = 135 ⇒ true')
    expect(html).toMatch(/data-sv-flow-run="3"[^>]*class="[^"]*surface-active/)
  })

  it('empty trace: the hint, download disabled', () => {
    const html = renderToStaticMarkup(
      <FlowPanel trace={[]} emptyText='Press Simulate' downloadName='f.jsonl' />
    )
    expect(html).toContain('Press Simulate')
    expect(html).toMatch(/aria-label="Download the flow as JSONL"[^>]*disabled/)
  })
})
