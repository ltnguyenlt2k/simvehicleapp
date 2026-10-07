/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Variable } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { adaptWorkflow, type WorkflowGraphOut } from '@/lib/sv/graph-adapter'
import { graphToSimState, isWorkflowGraph } from '@/lib/sv/graph-import'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * M09-T08: a workflow exported with its project (`.simvehicleapp/workflows/*.graph.json`) imports
 * back and adapts to the same graph — on the seven goldens, with the golden test's equivalences
 * (absent prop = BlockSpec default; edges compared by endpoints).
 */
const GOLDEN = fileURLToPath(new URL('./__golden__/', import.meta.url))
const SPECS = new Map(
  (
    specsSnapshot as {
      blocks: { type: string; props: { name: string; kind: string; default?: unknown }[] }[]
    }
  ).blocks.map((s) => [s.type, s.props])
)

function canonical(graph: WorkflowGraphOut) {
  const { revision: _revision, ...rest } = graph
  return {
    ...rest,
    edges: graph.edges.map((e) => [e.from, e.fromHandle, e.to, e.toHandle].join(' ')).sort(),
    blocks: graph.blocks
      .map((b) => {
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
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  }
}

const goldens = readdirSync(GOLDEN)
  .filter((d) => d.startsWith('GW-'))
  .sort()

describe('graph import (WorkflowGraph → studio state, M09-T08)', () => {
  for (const id of goldens) {
    it(`${id}: graph.json → studio → graph.json`, () => {
      const graph = JSON.parse(
        readFileSync(join(GOLDEN, id, 'graph.json'), 'utf8')
      ) as WorkflowGraphOut
      expect(isWorkflowGraph(graph)).toBe(true)
      const imported = graphToSimState(graph)
      const { graph: back, issues } = adaptWorkflow({
        workflowId: graph.workflowId,
        name: imported.name,
        vssRelease: imported.vssRelease ?? 'v4.0',
        state: imported,
        variables: imported.variables as Variable[],
      })
      expect(issues).toEqual([])
      expect(canonical(back)).toEqual(canonical(graph))
    })
  }

  it('lays blocks out in columns from the triggers, children inside their container', () => {
    const graph = JSON.parse(
      readFileSync(join(GOLDEN, 'GW-F', 'graph.json'), 'utf8')
    ) as WorkflowGraphOut
    const s = graphToSimState(graph)
    const container = Object.values(s.blocks).find((b) => b.type === 'parallel')!
    const child = Object.values(s.blocks).find((b) => b.data?.parentId === container.id)!
    expect(child.data?.extent).toBe('parent')
    expect(child.position.x).toBeLessThan((container.data?.width as number) ?? 0)
    const positions = Object.values(s.blocks)
      .filter((b) => !b.data?.parentId)
      .map((b) => `${b.position.x},${b.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('variables keep their SVX type through the round trip; Sim exports are not graphs', () => {
    const s = graphToSimState({
      graphVersion: '1.0.0',
      blocks: [],
      edges: [],
      variables: [
        { name: 'limit', type: 'double', initial: 120 },
        { name: 'armed', type: 'boolean', initial: true },
        { name: 'label', type: 'string', initial: 'x' },
        { name: 'cfg', type: 'json', initial: { a: 1 } },
      ],
    })
    const back = adaptWorkflow({
      workflowId: 'w',
      name: 'w',
      vssRelease: 'v4.0',
      state: s,
      variables: s.variables as Variable[],
    }).graph
    expect(back.variables).toEqual([
      { name: 'armed', type: 'boolean', initial: true },
      { name: 'cfg', type: 'json', initial: { a: 1 } },
      { name: 'label', type: 'string', initial: 'x' },
      { name: 'limit', type: 'double', initial: 120 },
    ])
    expect(isWorkflowGraph({ version: '1.0', state: { blocks: {}, edges: [] } })).toBe(false)
  })
})

describe("Sim's importer reads SimVehicleApp exports (M09-T08)", () => {
  it('a .graph.json parses into studio state with the graph name', async () => {
    const { extractWorkflowName, parseWorkflowJson } = await import(
      '@/lib/workflows/operations/import-export'
    )
    const content = readFileSync(join(GOLDEN, 'GW-A', 'graph.json'), 'utf8')
    const { data, errors } = parseWorkflowJson(content)
    expect(errors).toEqual([])
    const types = Object.values(data?.blocks ?? {})
      .map((b) => b.type)
      .sort()
    expect(types).toEqual([
      'sv_hmi_notify',
      'sv_on_signal_changed',
      'sv_on_signal_changed',
      'sv_set_actuator',
      'sv_set_actuator',
      'sv_stable_for',
    ])
    expect(data?.edges).toHaveLength(4)
    expect(extractWorkflowName(content, 'gw_a.graph.json')).toBe('Stable Overspeed Warning')
  })

  it('a project zip contributes only its .simvehicleapp/workflows/*.graph.json, without folders', async () => {
    const { extractWorkflowsFromZip } = await import('@/lib/workflows/operations/import-export')
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('.simvehicleapp/project.json', '{"slug":"p"}')
    zip.file(
      '.simvehicleapp/workflows/gw_a.graph.json',
      readFileSync(join(GOLDEN, 'GW-A', 'graph.json'), 'utf8')
    )
    zip.file('app/AppManifest.json', '{}')
    zip.file('app/vss/vss_rel_4.0.json', '{}')
    const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'p.zip')
    const { workflows } = await extractWorkflowsFromZip(file)
    expect(workflows.map((w) => [w.name, w.folderPath])).toEqual([['gw_a.graph.json', []]])
  })
})
