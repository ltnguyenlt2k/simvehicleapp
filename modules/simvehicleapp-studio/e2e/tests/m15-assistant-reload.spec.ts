import { expect, test } from '@playwright/test'
import {
  createWorkflow,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * Regression (found by the M15 full flow): a turn sent right after the editor loads must carry the loaded
 * workflow; accepting its proposal adds blocks and keeps the existing ones. Before the fix the half-loaded
 * canvas (no blocks) was sent and the accepted proposal deleted every existing block.
 */
test('assistant right after a reload: the proposal keeps the existing blocks', async ({ page }) => {
  test.setTimeout(180_000)
  await signUp(page, newUser('m15reload', 'Playwright Assistant Reload'))
  await setAutoConnect(page, false)
  await page.reload()
  await createWorkflow(page)
  await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 220, 260)
  await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

  await page.goto(new URL(page.url()).pathname)
  const sent = page.waitForRequest((r) => r.url().includes('/api/sv/ai/chat'))
  await page.locator('[data-tab-button="copilot"]').click()
  const panel = page.locator('[data-sv-assistant="panel"]')
  const input = panel.getByRole('textbox', { name: 'Message the assistant' })
  await expect(input).toBeEnabled({ timeout: 20_000 })
  await input.fill('Warn on the HMI when the battery is below 20 % while driving')
  await input.press('Enter')
  const body = JSON.parse((await sent).postData() ?? '{}') as {
    graph?: { blocks?: { name: string }[] }
  }
  expect(body.graph?.blocks?.map((b) => b.name)).toEqual(['When Speed changes 1'])

  const proposal = panel.locator('[data-sv-ai-proposal]')
  await expect(proposal).toBeVisible({ timeout: 120_000 })
  await proposal.locator('[data-sv-ai-preview]').click()
  await page.getByRole('button', { name: /^Accept/ }).click()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(4)
  await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()
})
