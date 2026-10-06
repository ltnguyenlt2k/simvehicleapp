import { expect, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dropSignal,
  editor,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M04-T11 on the real canvas: Verify runs every compiler check (types and units included, which
 * realtime lint does not), Problems focuses the field, and the Convert quick-fix repairs a narrowing
 * write so a second Verify is clean.
 */
test.describe('M4 Verify and quick-fix', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('narrowing write ⇒ Verify reports it ⇒ Insert Convert ⇒ Verify passes', async ({ page }) => {
    await signUp(page, newUser('m4', 'Playwright Verify'))
    await setAutoConnect(page, false)
    await page.reload() // the editor reads the setting once; reload so the drop below is not auto-connected
    await createWorkflow(page)

    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 300, 200)
    await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()
    await dropSignal(
      page,
      'Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed',
      'sv_set_actuator',
      800,
      200
    )
    const set = nodeByName(page, 'Set FanSpeed 1')
    await expect(set).toBeVisible()
    await connect(nodeByName(page, 'When Speed changes 1'), 'source', set)

    // A double (scale) written into a uint8 actuator: fine for lint, a narrowing for the type checker.
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('scale(<whenspeedchanges1.value>, 0, 200, 0, 100)')
    await value.press('Escape')
    await page.locator('[data-sv-tab="problems"]').click()
    const problems = page.locator('[data-sv="problems"]')
    await expect(problems).toContainText('No problems', { timeout: 20_000 })

    await page.locator('[data-sv-action="verify"]').click()
    await expect(problems).toHaveAttribute('data-sv-verified', 'true', { timeout: 20_000 })
    const narrowing = problems.locator('[data-sv-problem="TYPE_NARROWING_REQUIRES_CAST"]')
    await expect(narrowing).toBeVisible()
    await expect(narrowing).toHaveAttribute('data-sv-field', 'value')

    // Clicking the problem focuses the field in the editor.
    await narrowing.click()
    await expect(editor(page).locator('h2').first()).toHaveText('Set FanSpeed 1')

    await problems.locator('[data-sv-fix="TYPE_NARROWING_REQUIRES_CAST"]').click()
    const convert = nodeByName(page, 'Convert 1')
    await expect(convert).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)
    await set.click()
    await expect(subBlock(page, 'value').locator('textarea').first()).toHaveValue(
      '<convert1.result>'
    )

    // Editing invalidated the previous Verify; verify again.
    await expect(problems).not.toHaveAttribute('data-sv-verified', 'true')
    await page.locator('[data-sv-action="verify"]').click()
    await expect(problems).toHaveAttribute('data-sv-verified', 'true', { timeout: 20_000 })
    await expect(problems).toContainText('Verified · No problems')
  })
})
