import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, type Request, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  editor,
  newUser,
  nodeByName,
  pane,
  renameSelected,
  revealSubBlock,
  setAutoConnect,
  signUp,
  workflowIdOf,
} from '../lib/studio'

/**
 * M03-T13 / M3 gate: every golden workflow (contracts `fixtures/golden/GW-*`) is built on the canvas
 * through the UI only — toolbar and Vehicle-panel drops, rename, editor fields, handle-to-handle
 * edges — then Problems must be clean and the graph the studio adapter sends to lint must equal the
 * golden `graph.json` (ids mapped by block name; absent props = BlockSpec default; a non-string
 * literal in an expression prop = its SVX source). The recipe is derived from `graph.json`, so the
 * goldens stay the single source of truth.
 *
 * SV_GOLDEN_EXPORT=1 also writes `sim-state.json` next to each golden (M4 adapter golden input).
 */
const REPO = process.env.SV_REPO ?? fileURLToPath(new URL('../../../..', import.meta.url))
const GOLDEN_DIR = join(REPO, 'modules/simvehicleapp-contracts/fixtures/golden')
const SPECS_FILE = join(
  REPO,
  'modules/simvehicleapp-studio/apps/sim/blocks/vehicle/block-specs.json'
)
const EXPORT = process.env.SV_GOLDEN_EXPORT === '1'
const STATE = fileURLToPath(new URL('../.state/golden-user.json', import.meta.url))
mkdirSync(fileURLToPath(new URL('../.state', import.meta.url)), { recursive: true })

interface SpecProp {
  name: string
  kind: string
  default?: unknown
}
interface Spec {
  type: string
  props: SpecProp[]
}
interface GBlock {
  id: string
  type: string
  name: string
  props: Record<string, unknown>
  parentId: string | null
}
interface GEdge {
  id: string
  from: string
  fromHandle: string
  to: string
  toHandle: string
}
interface Graph {
  workflowId: string
  name: string
  vss: { release: string }
  variables: { name: string; type: string; initial: unknown }[]
  blocks: GBlock[]
  edges: GEdge[]
}

const SPECS = new Map(
  (JSON.parse(readFileSync(SPECS_FILE, 'utf8')) as { blocks: Spec[] }).blocks.map((s) => [
    s.type,
    s,
  ])
)

/** Blocks created by dropping their VSS signal from the Vehicle panel (path locked, ADR-0011 §2). */
const SIGNAL_DROP = new Set(['sv_on_signal_changed', 'sv_set_actuator', 'sv_read_signal'])

/** Toolbar entry of every other block used by the goldens (`Add <name>`). */
const TOOLBAR: Record<string, string> = {
  sv_on_app_start: 'When app starts',
  sv_on_timer: 'Every …',
  sv_on_condition: 'When condition becomes true',
  sv_if: 'If / Else',
  sv_expression: 'Expression',
  sv_stable_for: 'Stable for',
  sv_wait: 'Wait',
  sv_wait_until: 'Wait until',
  sv_log: 'Log',
  sv_mqtt_publish: 'Publish MQTT',
  sv_hmi_notify: 'HMI notification',
  sv_parallel: 'Parallel',
  sv_repeat: 'Loop',
  sv_while: 'Loop',
}

/** Dropdown labels (BlockConfig UI text) of the enum values the goldens use. */
const LABELS: Record<string, Record<string, string>> = {
  mode: {
    any: 'Any change',
    rising: 'Value rises',
    falling: 'Value falls',
    crosses_above: 'Crosses above threshold',
    crosses_below: 'Crosses below threshold',
    becomes: 'Becomes value',
  },
  concurrency: {
    restart: 'Restart the run',
    ignore: 'Ignore the event',
    queue: 'Queue it',
    parallel: 'Run in parallel',
  },
  severity: { info: 'Info', warning: 'Warning', critical: 'Critical' },
  payloadType: { text: 'Text', json: 'JSON' },
  level: { debug: 'debug', info: 'info', warn: 'warn', error: 'error' },
  onError: { continue: 'continue', stop: 'stop' },
}

/** Container props are set through Sim's loop/parallel editor, not BlockSpec fields. */
const CONTAINERS = new Set(['sv_parallel', 'sv_repeat', 'sv_while'])

const isDefault = (p: SpecProp, v: unknown) =>
  p.default !== undefined && String(p.default) === String(v)

/** Graph → comparable form: names instead of ids, defaults filled, expression literals as SVX. */
function normalize(g: Graph) {
  const nameOf = new Map(g.blocks.map((b) => [b.id, b.name]))
  const blocks = g.blocks
    .map((b) => {
      const spec = SPECS.get(b.type)
      const props: Record<string, unknown> = {}
      if (spec && !CONTAINERS.has(b.type)) {
        for (const p of spec.props) {
          let v = b.props[p.name] ?? p.default
          if (v === undefined) continue
          if (p.kind === 'expression' && typeof v !== 'string') v = String(v)
          props[p.name] = v
        }
      } else {
        Object.assign(props, b.props)
      }
      return {
        name: b.name,
        type: b.type,
        parent: b.parentId ? nameOf.get(b.parentId) : null,
        props,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const edges = g.edges
    .map((e) => `${nameOf.get(e.from)} [${e.fromHandle}] → ${nameOf.get(e.to)} [${e.toHandle}]`)
    .sort()
  return { vss: g.vss.release, variables: g.variables, blocks, edges }
}

/** Grid slot (pane coordinates) of the i-th top-level block. */
const slot = (i: number) => ({ x: 260 + (i % 3) * 400, y: 120 + Math.floor(i / 3) * 290 })

async function setProp(page: Page, b: GBlock, p: SpecProp, value: unknown) {
  const sb = await revealSubBlock(page, p.name)
  switch (p.kind) {
    case 'vss-path':
      await expect(sb.locator(`[data-sv="vss-path-card"][data-sv-path="${value}"]`)).toBeVisible()
      return
    case 'enum': {
      const label = LABELS[p.name]?.[String(value)] ?? String(value)
      // Sim's dropdown shows labels lower-cased.
      const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      await sb.getByRole('combobox').click()
      await page.getByRole('option', { name: exact }).click()
      await expect(sb.getByRole('combobox')).toContainText(label, { ignoreCase: true })
      return
    }
    case 'expression': {
      const ta = sb.locator('textarea').first()
      await ta.fill(typeof value === 'string' ? value : String(value))
      await ta.press('Escape')
      return
    }
    case 'template': {
      const ta = sb.locator('textarea').first()
      await ta.fill(String(value))
      await ta.press('Escape')
      return
    }
    case 'duration': {
      const box = sb.getByRole('textbox', { name: 'Duration' })
      await box.fill(String(value))
      await box.press('Tab')
      return
    }
    case 'typed-value':
    case 'integer':
    case 'number': {
      const box = sb.getByRole('textbox', { name: /^Value/ })
      await box.fill(String(value))
      await box.press('Tab')
      return
    }
    case 'string': {
      const input = sb.locator('input').first()
      await input.fill(String(value))
      await input.press('Tab')
      return
    }
    case 'boolean': {
      const sw = sb.getByRole('switch')
      if ((await sw.getAttribute('aria-checked')) !== String(value)) await sw.click()
      return
    }
    default:
      throw new Error(`${b.type}.${p.name}: no UI recipe for prop kind ${p.kind}`)
  }
}

/** Adds one block through the UI, renames it and fills every non-default prop. */
async function addBlock(page: Page, b: GBlock, at: { x: number; y: number }) {
  const before = await page.locator('.react-flow__node').count()
  if (SIGNAL_DROP.has(b.type)) {
    await dropSignal(page, String(b.props.path), b.type, at.x, at.y)
  } else {
    const name = TOOLBAR[b.type]
    if (!name) throw new Error(`no toolbar recipe for ${b.type}`)
    await dragFromToolbar(page, name, at.x, at.y)
  }
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1)
  await expect(editor(page)).toBeVisible()
  await renameSelected(page, b.name)
  const node = nodeByName(page, b.name)
  await expect(node).toBeVisible()
  if (CONTAINERS.has(b.type)) return
  const spec = SPECS.get(b.type)
  if (!spec) throw new Error(`unknown block type ${b.type}`)
  for (const p of spec.props) {
    const v = b.props[p.name]
    if (v === undefined || (p.kind !== 'vss-path' && isDefault(p, v))) continue
    await setProp(page, b, p, v)
  }
}

/** Pane coordinates inside the container block `parent` (k-th child). */
async function insideContainer(page: Page, parentName: string, k: number) {
  const box = await nodeByName(page, parentName).boundingBox()
  const paneBox = await pane(page).boundingBox()
  if (!box || !paneBox) throw new Error(`container ${parentName} not visible`)
  return { x: box.x - paneBox.x + 60 + k * 300, y: box.y - paneBox.y + 110 }
}

async function build(page: Page, g: Graph) {
  const top = g.blocks.filter((b) => !b.parentId)
  for (const [i, b] of top.entries()) {
    await addBlock(page, b, slot(i))
    const children = g.blocks.filter((c) => c.parentId === b.id)
    for (const [k, c] of children.entries()) {
      await addBlock(page, c, await insideContainer(page, b.name, k))
    }
  }
  const name = new Map(g.blocks.map((b) => [b.id, b.name]))
  for (const e of g.edges) {
    await connect(
      nodeByName(page, name.get(e.from)!),
      e.fromHandle,
      nodeByName(page, name.get(e.to)!),
      e.toHandle
    )
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/**
 * Studio state of the built workflow (GET /api/workflows/:id) shaped as the adapter input, with Sim's
 * random ids replaced by the golden ids (by block name) so the fixture is stable and diffable.
 */
async function exportSimState(page: Page, g: Graph, workflowId: string) {
  const res = await page.request.get(`/api/workflows/${workflowId}`)
  expect(res.ok()).toBeTruthy()
  const data = (await res.json()).data as {
    state: {
      blocks: Record<string, { name: string; type: string }>
      edges: unknown[]
      loops: unknown
      parallels: unknown
    }
    variables: Record<string, unknown>
  }
  const ids = new Map<string, string>([[workflowId, g.workflowId]])
  const byName = new Map(g.blocks.map((b) => [b.name, b.id]))
  for (const [id, b] of Object.entries(data.state.blocks)) {
    ids.set(
      id,
      byName.get(b.name) ??
        (b.type === 'start_trigger' || b.type === 'starter' ? 'start' : `x_${b.type}`)
    )
  }
  const doc = {
    workflowId,
    name: g.name,
    vssRelease: g.vss.release,
    state: {
      blocks: data.state.blocks,
      edges: data.state.edges,
      loops: data.state.loops,
      parallels: data.state.parallels,
    },
    variables: Object.values(data.variables),
  }
  let edgeNo = 0
  const edgeIds = new Map<string, string>()
  for (const e of data.state.edges as { id: string }[]) edgeIds.set(e.id, `e${++edgeNo}`)
  const text = JSON.stringify(doc, null, 2).replace(
    UUID,
    (id) => ids.get(id) ?? edgeIds.get(id) ?? id
  )
  return `${text}\n`
}

const goldens = readdirSync(GOLDEN_DIR)
  .filter((d) => d.startsWith('GW-'))
  .sort()

test.describe('M3 gate — golden workflows built on the canvas', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await signUp(page, newUser('golden', 'Playwright Golden'))
    await setAutoConnect(page, false)
    await page.context().storageState({ path: STATE })
    await page.close()
  })

  for (const id of goldens) {
    test(`${id} built through the UI lints clean and adapts to its graph.json`, async ({
      browser,
    }) => {
      test.setTimeout(240_000)
      const g = JSON.parse(readFileSync(join(GOLDEN_DIR, id, 'graph.json'), 'utf8')) as Graph
      const context = await browser.newContext({
        storageState: STATE,
        viewport: { width: 1920, height: 1080 },
      })
      const page = await context.newPage()
      await page.goto('/workspace')
      const workflowId = await createWorkflow(page)
      await build(page, g)

      await page.locator('[data-sv-tab="problems"]').click()
      await expect(page.locator('[data-sv="problems"]')).toContainText('No problems', {
        timeout: 20_000,
      })

      // Reload: the graph linted from the persisted state is what the adapter really produces.
      const linted = page.waitForRequest(
        (r: Request) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/sv/lint',
        { timeout: 30_000 }
      )
      await page.reload()
      const adapted = (JSON.parse((await linted).postData() ?? '{}') as { graph: Graph }).graph
      expect(workflowIdOf(page)).toBe(workflowId)
      expect(normalize(adapted)).toEqual(normalize(g))
      await page.locator('[data-sv-tab="problems"]').click()
      await expect(page.locator('[data-sv="problems"]')).toContainText('No problems', {
        timeout: 20_000,
      })

      if (EXPORT)
        writeFileSync(
          join(GOLDEN_DIR, id, 'sim-state.json'),
          await exportSimState(page, g, workflowId)
        )
      await context.close()
    })
  }
})
