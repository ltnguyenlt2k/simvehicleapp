import { expect, test } from '@playwright/test'
import {
  createWorkflow,
  dropSignal,
  newUser,
  nodeByName,
  pane,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * M17-T02 (ADR-0056): the editor offers no way to run a workflow on Sim's executor — no workflow chat (panel
 * button, canvas menu), no "Run from block" / "Run until block" (block menu, block action bar) — and the routes
 * behind them answer 404. Vehicle logic runs only through Simulate and Run.
 */
test.describe('M17 Sim executor surfaces hidden', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('no workflow chat, no run from/until block; chat and execute routes are 404', async ({
    page,
  }) => {
    await signUp(page, newUser('m17surf', 'Playwright Surfaces'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 300, 260)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await expect(trigger).toBeVisible()

    await pane(page).click({ button: 'right', position: { x: 900, y: 600 } })
    await expect(page.getByText('Open Variables', { exact: true })).toBeVisible()
    await expect(page.getByText('Open Chat', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await trigger.click({ button: 'right' })
    await expect(page.getByText('Open Editor', { exact: true })).toBeVisible()
    await expect(page.getByText('Run from block', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Run until block', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')

    for (const path of ['execute', 'chat']) {
      const res = await page.request.post(`/api/workflows/${workflowId}/${path}`, { data: {} })
      expect(res.status(), path).toBe(404)
    }
  })
})
