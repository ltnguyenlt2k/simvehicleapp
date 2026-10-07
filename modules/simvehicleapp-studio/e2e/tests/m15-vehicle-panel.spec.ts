import { expect, type Locator, type Page, test } from '@playwright/test'
import { createWorkflow, findSignal, newUser, openVehiclePanel, pane, signUp } from '../lib/studio'

/**
 * M15-T03 (SCENARIOS C1–C4): the Vehicle panel offers the blocks of each signal kind (ADR-0010 §6, ADR-0018 §2) on
 * both releases; the chosen block is created with the signal's name and path; a click opens the same menu (keyboard
 * path, block added at the viewport centre). No VSS release has an actuator array, so arrays are covered by a
 * string-array sensor (`Read`/`When changes` only) and by the unit test of `signalBlockChoices`.
 */
interface Case {
  path: string
  kind: string
  menu: string[]
  pick: string
  node: string
}
const CASES: Case[] = [
  {
    path: 'Vehicle.Speed',
    kind: 'sensor',
    menu: ['Read', 'When changes'],
    pick: 'sv_read_signal',
    node: 'Read Speed',
  },
  {
    path: 'Vehicle.Body.Lights.Hazard.IsSignaling',
    kind: 'actuator',
    menu: ['Read', 'When changes', 'Set'],
    pick: 'sv_set_actuator',
    node: 'Set IsSignaling',
  },
  {
    path: 'Vehicle.VehicleIdentification.VIN',
    kind: 'attribute',
    menu: ['Read attribute'],
    pick: 'sv_read_attribute',
    node: 'VIN',
  },
  {
    path: 'Vehicle.OBD.DTCList',
    kind: 'sensor array',
    menu: ['Read', 'When changes'],
    pick: 'sv_on_signal_changed',
    node: 'When DTCList changes',
  },
]

/** A canvas node whose name starts with `name` (a number is appended when the name is taken). */
const nodeNamed = (page: Page, name: string) =>
  page
    .locator('.react-flow__node')
    .filter({ has: page.locator(`[title^="${name}"]`) })
    .first()

/** Drags `row` onto the canvas and returns the drop menu (a lost synthetic drop is retried, as in lib/studio). */
async function dropMenu(page: Page, row: Locator, x: number, y: number): Promise<Locator> {
  const menu = page.locator('[data-sv="signal-drop-menu"]')
  await expect(async () => {
    await row
      .locator('[draggable="true"]')
      .dragTo(pane(page), { targetPosition: { x, y }, force: true })
    await expect(menu).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  return menu
}

test.describe('M15 Vehicle panel: kind × release', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  for (const release of ['v4.0', 'v4.2']) {
    test(`every kind on ${release}; click opens the same menu`, async ({ page }) => {
      test.setTimeout(180_000)
      await signUp(page, newUser(`m15p${release.replace('.', '')}`, 'Playwright Vehicle Panel'))
      await createWorkflow(page)
      const panel = await openVehiclePanel(page)
      const picker = panel.locator('[data-sv="vss-release-picker"]')
      if (release !== 'v4.0') {
        await picker.getByRole('button').click()
        await page.getByRole('menuitem', { name: release }).click()
      }
      await expect(picker).toContainText(release)

      for (const [i, c] of CASES.entries()) {
        const row = await findSignal(page, c.path)
        const menu = await dropMenu(page, row, 220 + i * 260, 220)
        await expect(menu.locator('[data-sv-block]'), `${c.kind} ${c.path}`).toHaveText(c.menu)
        await menu.locator(`[data-sv-block="${c.pick}"]`).click()
        await expect(menu).toBeHidden()
        const node = nodeNamed(page, c.node)
        await expect(node, `${c.kind} ⇒ ${c.node}`).toBeVisible()
        // the block is bound to the signal: its path shows in the editor
        await node.click({ position: { x: 24, y: 16 } })
        await expect(
          page.locator('[data-tab-content="editor"] [data-workflow-search-subblock-id="path"]')
        ).toContainText(c.path)
      }

      // keyboard/click path: the same menu, the block lands in the viewport
      const row = await findSignal(page, 'Vehicle.Cabin.Seat.Row1.DriverSide.Position')
      await row.locator('[draggable="true"]').click()
      const menu = page.locator('[data-sv="signal-drop-menu"]')
      await expect(menu).toBeVisible()
      await expect(menu.locator('[data-sv-block]')).toHaveText(['Read', 'When changes', 'Set'])
      await menu.locator('[data-sv-block="sv_read_signal"]').click()
      await expect(nodeNamed(page, 'Read Position')).toBeVisible()
    })
  }
})
