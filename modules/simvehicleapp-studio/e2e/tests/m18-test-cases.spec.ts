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
 * M18-T04/T06 in the browser: the Test tab of a workflow starts empty, Generate tests derives cases
 * from the workflow (boundary values, Stable for held and broken) with their expectations locked
 * from the simulator, every case passes Simulate all, cases are deleted and kept across a reload;
 * test cases the assistant proposes (scenario_propose, the ai-assistant mocked at the BFF) are added
 * to the Test tab from the assistant card. M18-T07: blocks are compact until selected or Details is on, and the Logic
 * view reads the workflow as sentences — a sentence selects its block.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'

/** "When Speed changes → Stable for 2 s (Speed > 120) → Hazard on", as in the M5 gate. */
async function buildOverspeed(page: Page) {
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
}

test.describe('M18 Test cases', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('empty Test tab ⇒ Generate tests ⇒ coverage ⇒ Simulate all passes ⇒ delete, kept after reload', async ({
    page,
  }) => {
    await signUp(page, newUser('m18', 'Playwright Test cases'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)
    await buildOverspeed(page)

    await page.locator('[data-sv-tab="simulation"]').click()
    await expect(page.locator('[data-sv-tab="simulation"]')).toHaveText(/Test/)
    const tab = page.locator('[data-sv="test-tab"]')
    await expect(tab.locator('[data-sv="test-empty"]')).toBeVisible({ timeout: 20_000 })

    await tab.locator('[data-sv="test-generate"]').click()
    const cases = tab.locator('[data-sv="test-case"]')
    await expect.poll(() => cases.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3)
    const generated = await cases.count()
    await expect(tab.locator('[data-sv="test-coverage"]')).toHaveText(
      /Branches covered: \d+ \/ \d+/
    )

    // The expectations were locked from the simulator: every case passes.
    await tab.locator('[data-sv="test-simulate-all"]').click()
    await expect(tab.locator('[data-sv-outcome="passed"]')).toHaveCount(generated, {
      timeout: 30_000,
    })
    await expect(tab.locator('[data-sv-outcome="failed"]')).toHaveCount(0)

    const last = cases.last()
    const lastName = (await last.locator('button').first().textContent())?.trim() ?? ''
    await last.hover()
    await last.getByRole('button', { name: `Delete ${lastName}` }).click()
    await expect(cases).toHaveCount(generated - 1)

    await page.reload()
    await page.locator('[data-sv-tab="simulation"]').click()
    await expect(page.locator('[data-sv="test-case"]')).toHaveCount(generated - 1, {
      timeout: 20_000,
    })
  })

  test('the assistant proposes test cases ⇒ Add to Test tab', async ({ page }) => {
    const proposed = [
      {
        name: 'Speed 121 for 2 s turns the hazard on',
        scenario: {
          scenarioVersion: '1.1.0',
          name: 'Speed 121',
          until: 4000,
          initial: { [SPEED]: 0 },
          inputs: [{ t: 1000, path: SPEED, value: 121 }],
          expect: { writes: [{ t: 3000, path: HAZARD, value: true }] },
        },
      },
      {
        name: 'Speed 120 does not',
        scenario: {
          scenarioVersion: '1.1.0',
          name: 'Speed 120',
          until: 4000,
          initial: { [SPEED]: 0 },
          inputs: [{ t: 1000, path: SPEED, value: 120 }],
          expect: { never: [{ path: HAZARD }] },
        },
      },
    ]
    await page.route('**/api/sv/ai/status', (route) =>
      route.fulfill({
        json: { configured: true, provider: 'scripted', model: 'e2e', externalServers: [] },
      })
    )
    await page.route(/\/api\/sv\/ai\/conversations\?workflowId=/, (route) =>
      route.fulfill({ json: { conversations: [] } })
    )
    const chats: { graph: { workflowId: string } }[] = []
    await page.route('**/api/sv/ai/chat', (route) => {
      chats.push(route.request().postDataJSON())
      const events = [
        { event: 'tool', data: { id: 't1', name: 'scenario_propose', input: {} } },
        {
          event: 'tool_result',
          data: {
            id: 't1',
            name: 'scenario_propose',
            isError: false,
            text: '2 test case(s) proposed',
            structured: { testCases: proposed, results: [] },
          },
        },
        { event: 'text', data: { delta: 'Two cases: one over the limit, one at it.' } },
        { event: 'done', data: { conversationId: 'c_tests', pending: false, steps: 2 } },
      ]
      return route.fulfill({
        headers: { 'content-type': 'text/event-stream' },
        body: events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join(''),
      })
    })

    await signUp(page, newUser('m18ai', 'Playwright Test assistant'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    await buildOverspeed(page)

    await page.locator('[data-tab-button="copilot"]').click()
    const panel = page.locator('[data-sv-assistant="panel"]')
    const input = panel.getByRole('textbox', { name: 'Message the assistant' })
    await expect(input).toBeEnabled({ timeout: 20_000 })
    await input.fill('Test this workflow')
    await input.press('Enter')

    const card = panel.locator('[data-sv-ai-tests]')
    await expect(card).toHaveAttribute('data-sv-ai-tests', 'new')
    await expect(card.locator('[data-sv-ai-test-case]')).toHaveCount(2)
    expect(chats[0]).toMatchObject({ graph: { workflowId } })

    await card.locator('[data-sv-ai-tests-accept]').click()
    await expect(card).toHaveAttribute('data-sv-ai-tests', 'accepted')
    // The Test tab comes to the front with the proposed cases.
    const tab = page.locator('[data-sv="test-tab"]')
    await expect(tab).toBeVisible()
    for (const c of proposed)
      await expect(tab.locator('[data-sv="test-case"]', { hasText: c.name })).toBeVisible()

    // The workflow meets both proposed cases.
    await tab.locator('[data-sv="test-simulate-all"]').click()
    await expect(tab.locator('[data-sv-outcome="passed"]')).toHaveCount(2, { timeout: 30_000 })
  })

  test('compact blocks ⇄ Details; Logic view reads the workflow and a sentence selects its block', async ({
    page,
  }) => {
    await signUp(page, newUser('m18lv', 'Playwright Logic view'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)
    await buildOverspeed(page)
    // Nothing selected: every vehicle block is compact, its summary still shown.
    await page.keyboard.press('Escape')
    const trigger = nodeByName(page, 'When Speed changes 1')
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 400 } })
    await expect(trigger.locator('[data-sv-compact]')).toHaveCount(1)
    await expect(trigger.locator('[data-sv="block-summary"]')).toContainText('When Speed changes')
    const details = page.locator('[data-sv-view="details"]')
    await details.click()
    await expect(details).toHaveAttribute('aria-pressed', 'true')
    await expect(trigger.locator('[data-sv-compact]')).toHaveCount(0)
    await details.click()

    await page.locator('[data-sv-view="logic"]').click()
    const logic = page.locator('[data-sv="logic-view"]')
    await expect(logic).toBeVisible()
    await expect(logic.locator('[data-sv-logic-line="trigger"]')).toContainText('When Speed changes')
    await expect(logic.locator('[data-sv-logic-line="branch"]')).toContainText('stable ⇒')
    const set = logic.locator('[data-sv-logic-line="step"]', { hasText: 'Set Hazard.IsSignaling = true' })
    await expect(set).toBeVisible()
    await set.click()
    // The editor panel opens on that block.
    await expect(page.locator('[data-tab-content="editor"]')).toContainText('Set IsSignaling 1')
    await logic.getByRole('button', { name: 'Close Logic view' }).click()
    await expect(logic).toHaveCount(0)
  })

})
