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
 * @live — the user-guide tutorial "Overspeed warning" (docs/user-guide/tutorial.md, M11-T02) on the
 * real stack, step by step: build the workflow on the canvas ⇒ simulate it ⇒ vehicle project ⇒
 * SynCode ⇒ Run on KUKSA ⇒ inject Speed ⇒ Hazard on ⇒ Stop ⇒ ask the assistant for a second behaviour
 * and accept its proposal. `SV_DEMO=1` records the demo video (1920×1080) with pauses to follow it.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const DEMO = process.env.SV_DEMO === '1'

test.use({
  viewport: { width: 1920, height: 1080 },
  video: DEMO ? { mode: 'on', size: { width: 1920, height: 1080 } } : 'off',
  launchOptions: { slowMo: DEMO ? 40 : 0 },
})

/** A pause the demo video needs to be followed (none in the test run). */
const pause = (page: Page, ms: number) => (DEMO ? page.waitForTimeout(ms) : Promise.resolve())

async function inject(page: Page, path: string, value: string) {
  const row = page.locator(`[data-sv-signal="${path}"]`)
  await row.getByRole('textbox', { name: `Value for ${path}` }).fill(value)
  await row.locator(`[data-sv-inject="${path}"]`).click()
}

test('@live tutorial "Overspeed warning": canvas ⇒ Simulate ⇒ SynCode ⇒ Run ⇒ inject ⇒ assistant', async ({
  page,
}) => {
  test.setTimeout(900_000)
  // 1. account + workflow
  await signUp(page, newUser('tutorial', 'Tutorial Driver'))
  await setAutoConnect(page, false)
  await page.reload()
  const workflowId = await createWorkflow(page)
  const editorUrl = new URL(page.url()).pathname
  await pause(page, 1000)

  // 2. trigger: when the speed changes
  await dropSignal(page, SPEED, 'sv_on_signal_changed', 220, 260)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
  await pause(page, 800)

  // 3. held for 2 s above 120 km/h
  await dragFromToolbar(page, 'Stable for', 620, 260)
  const stable = nodeByName(page, 'Stable for 1')
  await expect(stable).toBeVisible()
  await stable.click()
  const condition = subBlock(page, 'condition').locator('textarea').first()
  await condition.fill('<whenspeedchanges1.value> > 120')
  await condition.press('Escape')
  const duration = subBlock(page, 'durationMs').getByRole('textbox', { name: 'Duration' })
  await duration.fill('2000')
  await duration.press('Tab')
  await pause(page, 800)

  // 4. action: hazard lights on
  await dropSignal(page, HAZARD, 'sv_set_actuator', 1020, 260)
  const set = nodeByName(page, 'Set IsSignaling 1')
  await expect(set).toBeVisible()
  await set.click()
  const value = subBlock(page, 'value').locator('textarea').first()
  await value.fill('true')
  await value.press('Escape')
  await connect(trigger, 'source', stable)
  await connect(stable, 'stable', set)
  await pause(page, 1200)

  // 5. simulate: 100 at 1 s, 130 at 2 s ⇒ hazard on at 4 s
  await page.locator('[data-sv-tab="simulation"]').click()
  await page.locator('[data-sv="scenario-editor"]').getByRole('button', { name: 'YAML' }).click()
  await page
    .getByRole('textbox', { name: 'Scenario YAML' })
    .fill(
      [
        'scenarioVersion: 1.0.0',
        'name: Overspeed',
        'until: 6000',
        'initial:',
        `  ${SPEED}: 0`,
        `  ${HAZARD}: false`,
        'inputs:',
        `  - { t: 1000, path: ${SPEED}, value: 100 }`,
        `  - { t: 2000, path: ${SPEED}, value: 130 }`,
      ].join('\n')
    )
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.locator('[data-sv-action="simulate"]').click()
  const write = page.locator('[data-sv="simulation-timeline"] [data-sv-sim-row="write"]')
  await expect(write).toHaveCount(1, { timeout: 30_000 })
  await expect(write).toContainText('4000')
  const cursor = page.getByRole('slider', { name: 'Replay time' })
  for (const t of ['1000', '2000', '3000', '4000']) {
    await cursor.fill(t)
    await pause(page, 700)
  }
  await expect(set.locator('[data-sv="trace-badge"]')).toHaveAttribute('data-sv-replay', 'done')

  // 6. vehicle project + SynCode
  await page.getByRole('link', { name: 'Vehicle projects' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill(`Overspeed ${workflowId.slice(0, 6)}`)
  const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
  await page.locator('[data-sv="project-create-submit"]').click()
  const card = page.locator(`[data-sv-project="${slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 180_000 })
  await card.locator(`[data-sv-workflow="${workflowId}"]`).click()
  await pause(page, 800)
  await page.goto(editorUrl)
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText(
    'SynCode passed',
    { timeout: 300_000 }
  )
  await pause(page, 1500)

  // 7. run on the real databroker, inject the speed, the hazard lights switch on
  const workspaceId = editorUrl.split('/')[2]
  const listed = await page.request.get(`/api/sv/projects?workspaceId=${workspaceId}`)
  const projects = (await listed.json()) as { projects?: { id: string; slug: string }[] }
  expect(listed.ok(), JSON.stringify(projects)).toBe(true)
  const projectId = projects.projects?.find((p) => p.slug === slug)?.id
  expect(projectId).toBeTruthy()
  for (const field of ['target', 'value']) {
    await page.request.post(`/api/sv/projects/${projectId}/signals`, { data: { path: HAZARD, value: false, field } })
  }
  await page.locator('[data-sv-action="run"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running', {
    timeout: 60_000,
  })
  await page.locator('[data-sv-tab="signals"]').click()
  await inject(page, SPEED, '100')
  await pause(page, 1000)
  await inject(page, SPEED, '130')
  await page.waitForTimeout(3000)
  await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-target]`)).toHaveText('true')
  await page.locator('[data-sv-tab="run-console"]').click()
  await expect(page.getByRole('log', { name: 'Run console' })).toContainText('Set IsSignaling 1', {
    timeout: 15_000,
  })
  await pause(page, 1500)
  await page.locator('[data-sv-action="stop"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'stopped', {
    timeout: 15_000,
  })

  // 8. the assistant proposes a second behaviour; it is reviewed and accepted on the canvas
  await page.locator('[data-tab-button="copilot"]').click()
  const panel = page.locator('[data-sv-assistant="panel"]')
  const input = panel.getByRole('textbox', { name: 'Message the assistant' })
  await expect(input).toBeEnabled({ timeout: 20_000 })
  await input.fill('Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy')
  await pause(page, 600)
  await input.press('Enter')
  const card2 = panel.locator('[data-sv-ai-proposal]')
  await expect(card2).toBeVisible({ timeout: 120_000 })
  await expect(card2).toHaveAttribute('data-sv-ai-valid', 'true')
  await card2.locator('[data-sv-ai-preview]').click()
  await pause(page, 2000)
  await page.getByRole('button', { name: /^Accept/ }).click()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await pause(page, 2000)
})
