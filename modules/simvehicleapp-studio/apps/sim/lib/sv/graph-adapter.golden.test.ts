/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Variable } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { adaptWorkflow, type SimWorkflowState, type WorkflowGraphOut } from '@/lib/sv/graph-adapter'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * M04-T01 golden test: `sim-state.json` is the studio state of each golden workflow built through
 * the UI (contracts `fixtures/golden`, copied by `scripts/ci/golden_sync.py`); adapting it must give
 * the golden `graph.json`. Three documented equivalences only:
 * - a prop the studio did not store equals its BlockSpec default (lint/IR treat absent = default);
 * - a non-string literal in an expression prop equals its SVX source (`true` ≡ `"true"`, ADR-0014 Notes);
 * - edge ids are opaque (Sim's random ids in the studio, never used by the IR): edges compare by
 *   (from, fromHandle, to, toHandle).
 * `revision` is assigned by the server on save, so it is not part of the adapter output.
 */
const GOLDEN = fileURLToPath(new URL('./__golden__/', import.meta.url))

interface SpecProp {
  name: string
  kind: string
  default?: unknown
}
const SPECS = new Map(
  (specsSnapshot as { blocks: { type: string; props: SpecProp[] }[] }).blocks.map((s) => [
    s.type,
    s.props,
  ])
)

interface SimStateFile {
  workflowId: string
  name: string
  vssRelease: string
  state: SimWorkflowState
  variables: Variable[]
}

function canonical(graph: WorkflowGraphOut) {
  const { revision: _revision, ...rest } = graph
  return {
    ...rest,
    edges: graph.edges.map((e) => [e.from, e.fromHandle, e.to, e.toHandle].join(' ')).sort(),
    blocks: graph.blocks.map((b) => {
      const props = SPECS.get(b.type)
      if (!props) return b
      const filled: Record<string, unknown> = {}
      for (const p of props) {
        let v = b.props[p.name] ?? p.default
        if (v === undefined) continue
        if (p.kind === 'expression' && typeof v !== 'string') v = String(v)
        filled[p.name] = v
      }
      return { ...b, props: filled }
    }),
  }
}

const goldens = readdirSync(GOLDEN)
  .filter((d) => d.startsWith('GW-'))
  .sort()

describe('graph adapter golden (sim-state.json → graph.json)', () => {
  it('has every golden workflow', () => {
    expect(goldens).toEqual(['GW-A', 'GW-B', 'GW-C', 'GW-D', 'GW-E', 'GW-F', 'GW-G'])
  })

  for (const id of goldens) {
    it(`${id} adapts to its graph.json`, () => {
      const sim = JSON.parse(
        readFileSync(join(GOLDEN, id, 'sim-state.json'), 'utf8')
      ) as SimStateFile
      const golden = JSON.parse(
        readFileSync(join(GOLDEN, id, 'graph.json'), 'utf8')
      ) as WorkflowGraphOut
      const { graph, issues } = adaptWorkflow({
        workflowId: sim.workflowId,
        name: sim.name,
        vssRelease: sim.vssRelease,
        state: sim.state,
        variables: sim.variables,
      })
      expect(issues).toEqual([])
      expect(canonical(graph)).toEqual(canonical(golden))
    })

    it(`${id} adapts deterministically (same input ⇒ same bytes)`, () => {
      const text = readFileSync(join(GOLDEN, id, 'sim-state.json'), 'utf8')
      const run = () => {
        const sim = JSON.parse(text) as SimStateFile
        return JSON.stringify(
          adaptWorkflow({
            workflowId: sim.workflowId,
            name: sim.name,
            vssRelease: sim.vssRelease,
            state: sim.state,
            variables: sim.variables,
          }).graph
        )
      }
      expect(run()).toBe(run())
    })
  }
})
