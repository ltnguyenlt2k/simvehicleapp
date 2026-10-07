import { expect, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  newUser,
  nodeByName,
  openToolbar,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M14 #1 (ADR-0045) on the real canvas: the curated status blocks are in the toolbar, Door status offers
 * its doors by name (left unconnected: only a warning), and "When app starts → Battery status → Hazard =
 * low and not charging" simulates with every member read (one write at t=0).
 */
test.describe('M14 composite status blocks', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('toolbar, door choice and Battery status simulated', async ({ page }) => {
    await signUp(page, newUser('m14', 'Playwright Composite'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)

    const toolbar = await openToolbar(page)
    for (const name of ['Battery status', 'Door status', 'Climate status', 'Filter', 'State machine']) {
      await expect(toolbar.getByText(name, { exact: true }).first()).toBeVisible()
    }

    await dragFromToolbar(page, 'Door status', 600, 500)
    const door = nodeByName(page, 'Door status 1')
    await expect(door).toBeVisible()
    await door.click()
    await expect(subBlock(page, 'door')).toContainText(/front, driver side/i)

    await dragFromToolbar(page, 'When app starts', 200, 200)
    const start = nodeByName(page, 'When app starts 1')
    await dragFromToolbar(page, 'Battery status', 600, 200)
    const battery = nodeByName(page, 'Battery status 1')
    await expect(battery).toBeVisible()
    await dropSignal(page, 'Vehicle.Body.Lights.Hazard.IsSignaling', 'sv_set_actuator', 1000, 200)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await expect(set).toBeVisible()
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('<batterystatus1.soc> < 20 && !<batterystatus1.isCharging>')
    await value.press('Escape')
    await connect(start, 'source', battery)
    await connect(battery, 'source', set)

    await page.locator('[data-sv-tab="simulation"]').click()
    await page.locator('[data-sv="scenario-editor"]').getByRole('button', { name: 'YAML' }).click()
    await page
      .getByRole('textbox', { name: 'Scenario YAML' })
      .fill(
        [
          'scenarioVersion: 1.0.0',
          'name: Low battery',
          'until: 1000',
          'initial:',
          '  Vehicle.Powertrain.TractionBattery.StateOfCharge.Current: 15',
          '  Vehicle.Powertrain.TractionBattery.CurrentVoltage: 400',
          '  Vehicle.Powertrain.TractionBattery.CurrentCurrent: 10',
          '  Vehicle.Powertrain.TractionBattery.Charging.IsCharging: false',
          '  Vehicle.Body.Lights.Hazard.IsSignaling: false',
          'inputs: []',
        ].join('\n')
      )
    await page.getByRole('button', { name: 'Apply' }).click()

    await page.locator('[data-sv-action="simulate"]').click()
    const timeline = page.locator('[data-sv="simulation-timeline"]')
    await expect(timeline).toBeVisible({ timeout: 30_000 })
    const write = timeline.locator('[data-sv-sim-row="write"]')
    await expect(write).toHaveCount(1)
    await expect(write).toContainText('Vehicle.Body.Lights.Hazard.IsSignaling')
    await expect(write).toContainText('true')
    await expect(battery.locator('[data-sv="trace-badge"]')).toBeVisible()
  })
})
