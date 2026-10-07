import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  newUser,
  nodeByName,
  renameSelected,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M15-T04 (SCENARIOS D2–D5): branch handles connect, a rename rewrites the `<ref>`s that use the block, an edge that
 * would close a loop is refused, delete/undo/redo restore a block and its edge, copy/paste duplicates a block and Delete
 * removes it.
 */
const edges = (page: Page) => page.locator('.react-flow__edge')
const nodes = (page: Page) => page.locator('.react-flow__node')

/** Drags from `from[fromHandle]` to `to`'s input handle without expecting an edge (lib `connect` expects one). */
async function tryConnect(from: Locator, fromHandle: string, to: Locator) {
  const page = from.page()
  const a = await from
    .locator(`.react-flow__handle[data-handleid="${fromHandle}"]`)
    .first()
    .boundingBox()
  const b = await to.locator('.react-flow__handle.target').first().boundingBox()
  if (!a || !b) throw new Error(`handle not visible: ${fromHandle}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test.describe('M15 connect and edit', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('branches, rename ⇒ refs, cycle refused, delete/undo/redo, copy/paste', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await signUp(page, newUser('m15edit', 'Playwright Edit'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)

    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 200, 300)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await dragFromToolbar(page, 'If / Else', 600, 300)
    const branch = nodeByName(page, 'If / Else 1')
    await branch.click()
    const condition = subBlock(page, 'condition').locator('textarea').first()
    await condition.fill('<whenspeedchanges1.value> > 120')
    await condition.press('Escape')
    await dropSignal(page, 'Vehicle.Body.Lights.Hazard.IsSignaling', 'sv_set_actuator', 1050, 180)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('true')
    await value.press('Escape')
    await dragFromToolbar(page, 'Log', 1050, 480)
    const log = nodeByName(page, 'Log 1')
    await log.click()
    const message = subBlock(page, 'message').locator('textarea').first()
    await message.fill('below 120 km/h')
    await message.press('Escape')
    await connect(trigger, 'source', branch)
    await connect(branch, 'then', set)
    await connect(branch, 'else', log)
    await expect(edges(page)).toHaveCount(3)
    await expect(page.locator('[data-sv="block-problems"][data-sv-severity="error"]')).toHaveCount(
      0,
      {
        timeout: 20_000,
      }
    )

    // rename the trigger: the condition follows
    await trigger.click({ position: { x: 24, y: 16 } })
    await renameSelected(page, 'Speed')
    await branch.click({ position: { x: 24, y: 16 } })
    await expect(subBlock(page, 'condition').locator('textarea').first()).toHaveValue(
      '<speed.value> > 120'
    )

    // Log → If would close a loop: the canvas refuses the edge (lint would report CONTROL_FLOW_CYCLE)
    await tryConnect(log, 'source', branch)
    await page.waitForTimeout(500)
    await expect(edges(page)).toHaveCount(3)

    // delete the Log block (and its edge), undo brings both back, redo removes them, undo again
    const total = await nodes(page).count()
    await log.click({ position: { x: 24, y: 16 } })
    await page.keyboard.press('Delete')
    await expect(nodes(page)).toHaveCount(total - 1)
    await expect(edges(page)).toHaveCount(2)
    await page.locator('.react-flow__pane').click({ position: { x: 40, y: 40 } })
    await page.keyboard.press('Control+z')
    await expect(nodes(page)).toHaveCount(total)
    await expect(edges(page)).toHaveCount(3)
    await page.keyboard.press('Control+Shift+z')
    await expect(nodes(page)).toHaveCount(total - 1)
    await page.keyboard.press('Control+z')
    await expect(edges(page)).toHaveCount(3)
    await expect(log).toBeVisible()

    // copy/paste the Log block, then delete the copy
    const before = await nodes(page).count()
    await log.click({ position: { x: 24, y: 16 } })
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Control+v')
    await expect(nodes(page)).toHaveCount(before + 1)
    const copy = nodes(page)
      .filter({ has: page.locator('[title^="Log"]') })
      .filter({ hasNot: page.locator('[title="Log 1"]') })
    await expect(copy).toHaveCount(1)
    await copy.click({ position: { x: 24, y: 16 } })
    await page.keyboard.press('Delete')
    await expect(nodes(page)).toHaveCount(before)
    await expect(log).toBeVisible()
  })
})
