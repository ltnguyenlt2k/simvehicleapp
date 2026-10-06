import { expect, type Page, test } from '@playwright/test'
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
 * @live — needs the full dev stack (`scripts/sv up`), skipped in CI like m7-syncode-live.
 *
 * M8 gate through the UI: "When Speed changes → Stable for 2 s (> 120) → Set Hazard on" ⇒ SynCode ⇒
 * Run ⇒ Signals: inject Speed 100 then 130 and hold 3 s ⇒ Hazard.IsSignaling switches (target and,
 * mirrored, current) ⇒ live overlay counts Stable for and Set ⇒ reload keeps the run log (SSE resume)
 * ⇒ Stop in < 5 s.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'

/** The console is virtualized: search narrows it to the matching entries, then the text is checked. */
async function consoleHas(page: Page, text: string, timeout = 15_000) {
  const search = page.getByRole('textbox', { name: 'Search the run log' })
  await search.fill(text)
  await expect(page.getByRole('log', { name: 'Run console' })).toContainText(text, { timeout })
  await search.fill('')
}

async function inject(page: Page, path: string, value: string) {
  const row = page.locator(`[data-sv-signal="${path}"]`)
  await row.getByRole('textbox', { name: `Value for ${path}` }).fill(value)
  await row.locator(`[data-sv-inject="${path}"]`).click()
}

test.describe('M8 live run on the real stack', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('@live GW-A-like workflow: SynCode ⇒ Run ⇒ inject ⇒ Hazard on ⇒ trace ⇒ reload ⇒ Stop', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    await signUp(page, newUser('m8live', 'Playwright Live Run'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    const editorUrl = new URL(page.url()).pathname

    await dropSignal(page, SPEED, 'sv_on_signal_changed', 200, 200)
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
    await dropSignal(page, HAZARD, 'sv_set_actuator', 1000, 200)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await expect(set).toBeVisible()
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('true')
    await value.press('Escape')
    await connect(trigger, 'source', stable)
    await connect(stable, 'stable', set)

    // project + SynCode
    await page.getByRole('link', { name: 'Vehicle projects' }).click()
    await page.getByRole('textbox', { name: 'Project name' }).fill(`Run ${workflowId.slice(0, 8)}`)
    const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
    await page.locator('[data-sv="project-create-submit"]').click()
    const card = page.locator(`[data-sv-project="${slug}"]`)
    await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', {
      timeout: 180_000,
    })
    await card.locator(`[data-sv-workflow="${workflowId}"]`).click()
    await page.goto(editorUrl)
    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 30_000 })
    await syncode.click()
    await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText(
      'SynCode passed',
      { timeout: 240_000 }
    )

    // Run ⇒ running
    const runButton = page.locator('[data-sv-action="run"]')
    await expect(runButton).toBeEnabled()
    await runButton.click()
    await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute(
      'data-sv-state',
      'running',
      {
        timeout: 30_000,
      }
    )
    await consoleHas(page, 'app.started')

    // Signals: Speed 100 then 130 held 3 s ⇒ Hazard on (target, and current through the gateway mirror)
    await page.locator('[data-sv-tab="signals"]').click()
    await expect(page.locator(`[data-sv-signal="${HAZARD}"]`)).toBeVisible()
    await inject(page, SPEED, '100')
    await expect(page.locator(`[data-sv-signal="${SPEED}"] [data-sv-signal-value]`)).toHaveText(
      '100'
    )
    await inject(page, SPEED, '130')
    await expect(page.locator(`[data-sv-signal="${SPEED}"] [data-sv-signal-value]`)).toHaveText(
      '130'
    )
    await page.waitForTimeout(3000)
    await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-target]`)).toHaveText(
      'true'
    )
    await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-value]`)).toHaveText(
      'true'
    )

    // live overlay: Stable for ran and Set wrote true
    await expect(stable.locator('[data-sv="trace-badge"]')).toHaveAttribute(
      'data-sv-live',
      /done|running/
    )
    await expect(set.locator('[data-sv="trace-badge"]')).toHaveText(/\d+×/)
    await page.locator('[data-sv-tab="run-console"]').click()
    await consoleHas(page, '· Stable for 1')
    await consoleHas(page, '· Set IsSignaling 1')

    // reload: the run log comes back from the stored stream
    await page.reload()
    await expect(page.locator('.react-flow__renderer')).toBeVisible()
    await page.locator('[data-sv-tab="run-console"]').click()
    await expect(page.getByRole('log', { name: 'Run console' })).toContainText('app.started', {
      timeout: 30_000,
    })
    await expect(page.getByRole('log', { name: 'Run console' })).toContainText(
      '· Set IsSignaling 1'
    )

    // Stop < 5 s
    const stopAt = Date.now()
    await page.locator('[data-sv-action="stop"]').click()
    await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute(
      'data-sv-state',
      'stopped',
      {
        timeout: 10_000,
      }
    )
    expect(Date.now() - stopAt).toBeLessThan(7_000) // < 5 s stop + UI polling (2 s)
    await consoleHas(page, 'app.stopping')
  })
})
