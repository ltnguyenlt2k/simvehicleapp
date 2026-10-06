import { expect, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M05-T09/T10 on the real canvas (M5 gate example): "When Speed changes → Stable for 2 s → Hazard on";
 * Speed 100 → 130 at t=1000 ⇒ the write happens at t=3000; the replay cursor shows Stable for running
 * at t=2000 and the write done at t=3000. The scenario is saved with the workflow.
 */
test.describe('M5 Simulate', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('scenario ⇒ Simulate ⇒ timeline and replay overlay', async ({ page }) => {
    await signUp(page, newUser('m5', 'Playwright Simulate'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)

    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 200, 200)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await expect(trigger).toBeVisible()
    await dragFromToolbar(page, 'Stable for', 600, 200)
    const stable = nodeByName(page, 'Stable for 1')
    await expect(stable).toBeVisible()
    await stable.click()
    const condition = subBlock(page, 'condition').locator('textarea').first()
    await condition.fill('<whenspeedchanges1.value> > 120')
    await condition.press('Escape')
    const duration = subBlock(page, 'durationMs').getByRole('textbox', { name: 'Duration' })
    await duration.fill('2000')
    await duration.press('Tab')
    await dropSignal(page, 'Vehicle.Body.Lights.Hazard.IsSignaling', 'sv_set_actuator', 1000, 200)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await expect(set).toBeVisible()
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('true')
    await value.press('Escape')
    await connect(trigger, 'source', stable)
    await connect(stable, 'stable', set)

    await page.locator('[data-sv-tab="simulation"]').click()
    await page.locator('[data-sv="scenario-editor"]').getByRole('button', { name: 'YAML' }).click()
    await page
      .getByRole('textbox', { name: 'Scenario YAML' })
      .fill(
        [
          'scenarioVersion: 1.0.0',
          'name: Overspeed',
          'until: 5000',
          'initial:',
          '  Vehicle.Speed: 100',
          '  Vehicle.Body.Lights.Hazard.IsSignaling: false',
          'inputs:',
          '  - { t: 1000, path: Vehicle.Speed, value: 130 }',
        ].join('\n')
      )
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('[data-sv="scenario-input-row"]')).toHaveCount(1)

    // Simulate keeps the simulated scenario with the workflow (saved without waiting for the debounce).
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/scenario') && r.ok()
    )
    await page.locator('[data-sv-action="simulate"]').click()
    await saved
    const timeline = page.locator('[data-sv="simulation-timeline"]')
    await expect(timeline).toBeVisible({ timeout: 30_000 })
    const write = timeline.locator('[data-sv-sim-row="write"]')
    await expect(write).toHaveCount(1)
    await expect(write).toContainText('3000')
    await expect(write).toContainText('Vehicle.Body.Lights.Hazard.IsSignaling')

    // Replay: at 2000 the stable window is open, at 3000 the write is done.
    const cursor = page.getByRole('slider', { name: 'Replay time' })
    await cursor.fill('2000')
    await expect(stable.locator('[data-sv="trace-badge"]')).toHaveAttribute(
      'data-sv-replay',
      'running'
    )
    await cursor.fill('3000')
    await expect(set.locator('[data-sv="trace-badge"]')).toHaveAttribute('data-sv-replay', 'done')
    await expect(set.locator('[data-sv="trace-badge"]')).toHaveText('1×')

    // The scenario was saved with the workflow.
    await page.reload()
    await page.locator('[data-sv-tab="simulation"]').click()
    await expect(page.locator('[data-sv="scenario-input-row"]')).toHaveCount(1)
    await expect(page.getByRole('textbox', { name: 'Input signal' })).toHaveValue('Vehicle.Speed')
  })
})
