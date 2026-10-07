import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  createWorkflow,
  dragFromToolbar,
  editor,
  newUser,
  nodeByName,
  openToolbar,
  revealSubBlock,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * M15-T02 (SCENARIOS B1/B2/B5): every `sv_*` block of the toolbar is dropped on the canvas; the node gets its
 * default name, its editor shows the spec's first prop, and its handles are the spec's (triggers: `source` only;
 * steps: `target` + the spec's out handles). Container specs come through Sim's Loop/Parallel.
 */
interface Spec {
  type: string
  category: string
  props: { name: string }[]
  handles: { in: string[]; out: string[] }
}
const REPO = process.env.SV_REPO ?? fileURLToPath(new URL('../../../..', import.meta.url))
const SPECS = (
  JSON.parse(
    readFileSync(
      join(REPO, 'modules/simvehicleapp-studio/apps/sim/blocks/vehicle/block-specs.json'),
      'utf8'
    )
  ) as { blocks: Spec[] }
).blocks
const CONTAINERS = new Set(['sv_parallel', 'sv_repeat', 'sv_while'])

/** Toolbar name of every block; a new BlockSpec fails the first test until it is listed here. */
const NAMES: Record<string, string> = {
  sv_array_at: 'Array element at',
  sv_array_contains: 'Array contains',
  sv_array_length: 'Array length',
  sv_battery_status: 'Battery status',
  sv_bool: 'And / Or / Not / Xor',
  sv_clamp: 'Clamp',
  sv_climate_status: 'Climate status',
  sv_compare: 'Compare',
  sv_constant: 'Constant',
  sv_convert: 'Convert unit/type',
  sv_counter: 'Counter',
  sv_door_status: 'Door status',
  sv_expression: 'Expression',
  sv_filter: 'Filter',
  sv_hmi_notify: 'HMI notification',
  sv_if: 'If / Else',
  sv_in_range: 'In range / Hysteresis',
  sv_log: 'Log',
  sv_lookup: 'Lookup table',
  sv_math: 'Math',
  sv_mqtt_publish: 'Publish MQTT',
  sv_on_app_start: 'When app starts',
  sv_on_condition: 'When condition becomes true',
  sv_on_mqtt: 'When MQTT message',
  sv_on_signal_changed: 'When signal changes',
  sv_on_timer: 'Every …',
  sv_read_attribute: 'Read attribute',
  sv_read_signal: 'Read signal',
  sv_scale: 'Map range',
  sv_set_actuator: 'Set actuator',
  sv_stable_for: 'Stable for',
  sv_state_machine: 'State machine',
  sv_stop: 'Stop',
  sv_switch: 'Switch',
  sv_var_get: 'Get variable',
  sv_var_set: 'Set variable',
  sv_wait: 'Wait',
  sv_wait_until: 'Wait until',
}

const BLOCKS = SPECS.filter((s) => !CONTAINERS.has(s.type))
const BATCH = 12

/** Canvas handle ids the node must show: `case` has no rows yet, so only `default`. */
function expectedHandles(spec: Spec): string[] {
  if (spec.category === 'triggers') return ['source']
  return ['target', ...spec.handles.out.filter((h) => h !== 'case')]
}

test.describe('M15 toolbar: every block on the canvas', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('the toolbar names every BlockSpec (containers via Loop/Parallel)', () => {
    expect(Object.keys(NAMES).sort()).toEqual(BLOCKS.map((s) => s.type).sort())
  })

  for (let start = 0; start < BLOCKS.length; start += BATCH) {
    const batch = BLOCKS.slice(start, start + BATCH)
    test(`drop ${batch[0]!.type} … ${batch.at(-1)!.type}`, async ({ page }) => {
      test.setTimeout(240_000)
      await signUp(page, newUser(`m15b${start}`, 'Playwright Toolbar'))
      await setAutoConnect(page, false)
      await page.reload()
      await createWorkflow(page)

      const toolbar = await openToolbar(page)
      await expect(
        toolbar.getByRole('button', { name: 'Add Loop', exact: true }).first()
      ).toBeVisible()
      await expect(
        toolbar.getByRole('button', { name: 'Add Parallel', exact: true }).first()
      ).toBeVisible()

      for (const [i, spec] of batch.entries()) {
        const name = NAMES[spec.type]!
        await dragFromToolbar(page, name, 140 + (i % 4) * 300, 120 + Math.floor(i / 4) * 230)
        const node = nodeByName(page, `${name} 1`)
        await expect(node, spec.type).toBeVisible()
        for (const h of expectedHandles(spec)) {
          await expect(
            node.locator(`[data-handleid="${h}"]`),
            `${spec.type} handle ${h}`
          ).toHaveCount(1)
        }
        if (spec.category !== 'triggers' && !spec.handles.out.includes('error')) {
          await expect(
            node.locator('[data-handleid="error"]'),
            `${spec.type} has no error`
          ).toHaveCount(0)
        }
        const first = spec.props[0]
        if (first) {
          await node.click({ position: { x: 24, y: 16 } })
          await expect(editor(page).locator('h2').first(), `${spec.type} editor`).toHaveText(
            `${name} 1`
          )
          // advanced props sit behind "Show additional fields"
          await revealSubBlock(page, first.name)
        }
      }
    })
  }
})
