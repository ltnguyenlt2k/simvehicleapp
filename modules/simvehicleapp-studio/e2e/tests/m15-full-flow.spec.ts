import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  logIn,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M15-T06 (SCENARIOS H2) — @live, the whole product on the real stack, one user, one workflow:
 * sign-up ⇒ GW-A "Stable overspeed warning" built by drag and drop ⇒ lint clean ⇒ Simulate ⇒ project ⇒
 * SynCode ⇒ Run on KUKSA ⇒ Signals inject ⇒ hazard on (trace) ⇒ Open IDE ⇒ Export zip ⇒ assistant
 * proposal accepted (fake provider) ⇒ then, after the stack restarts, `@live-restart` finds it all again.
 *
 * `SV_DEMO=1` records the demo video (1920×1080) with captions and pauses (`scripts/sv demo-video`).
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const DEMO = process.env.SV_DEMO === '1'
const STATE = fileURLToPath(new URL('../.state/full-flow.json', import.meta.url))
mkdirSync(fileURLToPath(new URL('../.state', import.meta.url)), { recursive: true })

test.use({
  viewport: { width: 1920, height: 1080 },
  video: DEMO ? { mode: 'on', size: { width: 1920, height: 1080 } } : 'off',
  launchOptions: { slowMo: DEMO ? 40 : 0 },
})

/** A pause the demo video needs to be followed (none in the test run). */
const pause = (page: Page, ms: number) => (DEMO ? page.waitForTimeout(ms) : Promise.resolve())

/** Demo caption at the bottom of the page (video only; a navigation clears it, so steps set it again). */
async function caption(page: Page, text: string) {
  if (!DEMO) return
  await page.evaluate((t) => {
    let el = document.getElementById('sv-demo-caption')
    if (!el) {
      el = document.createElement('div')
      el.id = 'sv-demo-caption'
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        background: 'rgba(15, 23, 42, 0.9)',
        color: '#fff',
        font: '600 24px/1.35 system-ui, sans-serif',
        padding: '12px 24px',
        borderRadius: '10px',
        pointerEvents: 'none',
        maxWidth: '80%',
        textAlign: 'center',
      })
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
  await page.waitForTimeout(1200)
}

async function inject(page: Page, path: string, value: string) {
  const row = page.locator(`[data-sv-signal="${path}"]`)
  await row.getByRole('textbox', { name: `Value for ${path}` }).fill(value)
  await row.locator(`[data-sv-inject="${path}"]`).click()
}

interface FlowState {
  email: string
  password: string
  editorUrl: string
  slug: string
}

test('@live full flow: build ⇒ lint ⇒ Simulate ⇒ SynCode ⇒ Run ⇒ IDE ⇒ Export ⇒ assistant', async ({
  page,
}) => {
  test.setTimeout(1_200_000)
  const user = newUser('fullflow', 'Demo Driver')
  await page.goto('/signup')
  await caption(page, '1 · Sign up — SimVehicleApp runs entirely in Docker Compose on localhost')
  await signUp(page, user)
  await setAutoConnect(page, false)
  await page.reload()
  const workflowId = await createWorkflow(page)
  const editorUrl = new URL(page.url()).pathname

  await caption(page, '2 · Drag a VSS signal from the Vehicle panel: When Vehicle.Speed changes')
  await dropSignal(page, SPEED, 'sv_on_signal_changed', 220, 260)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
  await pause(page, 600)

  await caption(page, '3 · Stable for 2 s: the speed stays above 120 km/h')
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
  await pause(page, 600)

  await caption(page, '4 · Set the actuator Hazard.IsSignaling = true, then connect the blocks')
  await dropSignal(page, HAZARD, 'sv_set_actuator', 1020, 260)
  const set = nodeByName(page, 'Set IsSignaling 1')
  await expect(set).toBeVisible()
  await set.click()
  const value = subBlock(page, 'value').locator('textarea').first()
  await value.fill('true')
  await value.press('Escape')
  await connect(trigger, 'source', stable)
  await connect(stable, 'stable', set)

  await caption(page, '5 · Realtime lint: no errors or warnings on any block')
  await expect(page.locator('[data-sv="block-problems"]')).toHaveCount(0, { timeout: 20_000 })
  await pause(page, 800)

  await caption(page, '6 · Simulate without building: 130 km/h at 2 s ⇒ hazard on at 4 s')
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
    await pause(page, 600)
  }
  await expect(set.locator('[data-sv="trace-badge"]')).toHaveAttribute('data-sv-replay', 'done')

  await caption(page, '7 · Vehicle project: a Velocitas C++ app, created offline')
  await page.getByRole('link', { name: 'Vehicle projects' }).click()
  await caption(page, '7 · Vehicle project: a Velocitas C++ app, created offline')
  await page
    .getByRole('textbox', { name: 'Project name' })
    .fill(`Overspeed ${workflowId.slice(0, 6)}`)
  const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
  await page.locator('[data-sv="project-create-submit"]').click()
  const card = page.locator(`[data-sv-project="${slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 180_000 })
  await card.locator(`[data-sv-workflow="${workflowId}"]`).click()
  await pause(page, 600)

  await page.goto(editorUrl)
  await caption(page, '8 · SynCode: graph ⇒ IR ⇒ C++ ⇒ build ⇒ generated unit tests (no LLM)')
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText(
    'SynCode passed',
    { timeout: 300_000 }
  )
  await pause(page, 1000)

  await caption(page, '9 · Run on the KUKSA databroker, inject the speed from the Signals panel')
  const workspaceId = editorUrl.split('/')[2]
  const listed = await page.request.get(`/api/sv/projects?workspaceId=${workspaceId}`)
  const projects = (await listed.json()) as { projects?: { id: string; slug: string }[] }
  expect(listed.ok(), JSON.stringify(projects)).toBe(true)
  const projectId = projects.projects?.find((p) => p.slug === slug)?.id
  expect(projectId).toBeTruthy()
  for (const field of ['target', 'value']) {
    await page.request.post(`/api/sv/projects/${projectId}/signals`, {
      data: { path: HAZARD, value: false, field },
    })
  }
  await page.locator('[data-sv-action="run"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running', {
    timeout: 60_000,
  })
  await page.locator('[data-sv-tab="signals"]').click()
  await inject(page, SPEED, '100')
  await pause(page, 800)
  await inject(page, SPEED, '130')
  await page.waitForTimeout(3000)
  await caption(page, '10 · Held above 120 km/h for 2 s ⇒ the app switched the hazard lights on')
  await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-target]`)).toHaveText(
    'true'
  )
  await page.locator('[data-sv-tab="run-console"]').click()
  await expect(page.getByRole('log', { name: 'Run console' })).toContainText('Set IsSignaling 1', {
    timeout: 15_000,
  })
  await expect(set.locator('[data-sv="trace-badge"]')).toBeVisible()
  await pause(page, 1200)
  await page.locator('[data-sv-action="stop"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'stopped', {
    timeout: 15_000,
  })

  await caption(
    page,
    '11 · Export: the Velocitas project as a zip, with notices and the workflow graph'
  )
  const exportButton = page.locator('[data-sv-action="export"]')
  await expect(exportButton).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toBe(`${slug}.zip`)
  const zip = readFileSync(await download.path()).toString('latin1')
  for (const name of ['.simvehicleapp/workflows/', 'THIRD-PARTY-NOTICES', 'app/src/generated/'])
    expect(zip).toContain(name)
  await pause(page, 800)

  await caption(page, '12 · Open IDE: VS Code (code-server) on the same project')
  const openIde = page.locator('[data-sv-action="open-ide"]')
  await expect(openIde).toBeEnabled()
  const [popup] = await Promise.all([page.waitForEvent('popup'), openIde.click()])
  await popup.waitForLoadState()
  const password = popup.locator('input[name="password"]')
  if (await password.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await password.fill(process.env.SV_IDE_PASSWORD ?? 'simvehicleapp')
    await password.press('Enter')
  }
  await expect(popup).toHaveURL(/folder=/, { timeout: 60_000 })
  const ideUrl = popup.url()
  await popup.close()
  // the IDE is shown in the recorded tab (a popup would be a separate video)
  await page.goto(ideUrl)
  await caption(page, '12 · Open IDE: VS Code (code-server) on the same project')
  const explorer = page.locator('.explorer-folders-view')
  for (const folder of ['app', 'src', 'generated']) {
    const item = explorer.getByRole('treeitem', { name: folder, exact: true })
    await expect(item).toBeVisible({ timeout: 120_000 })
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
  const source = explorer.getByRole('treeitem', { name: 'SimVehicleApp.cpp', exact: true })
  await expect(source).toBeVisible()
  await source.dblclick()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('SimVehicleApp', {
    timeout: 30_000,
  })
  await pause(page, 2500)

  await page.goto(editorUrl)
  await caption(
    page,
    '13 · Assistant (offline fake provider): proposes a second behaviour as a patch'
  )
  await page.locator('[data-tab-button="copilot"]').click()
  const panel = page.locator('[data-sv-assistant="panel"]')
  const input = panel.getByRole('textbox', { name: 'Message the assistant' })
  await expect(input).toBeEnabled({ timeout: 20_000 })
  await input.fill('Warn on the HMI when the battery is below 20 % while driving')
  await pause(page, 500)
  await input.press('Enter')
  const proposal = panel.locator('[data-sv-ai-proposal]')
  await expect(proposal).toBeVisible({ timeout: 120_000 })
  await expect(proposal).toHaveAttribute('data-sv-ai-valid', 'true')
  await proposal.locator('[data-sv-ai-preview]').click()
  await pause(page, 1500)
  await caption(page, '14 · Review on the canvas, then Accept — the user stays in control')
  await page.getByRole('button', { name: /^Accept/ }).click()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await pause(page, 1500)

  const state: FlowState = { email: user.email, password: user.password, editorUrl, slug }
  writeFileSync(STATE, JSON.stringify(state))
})

test('@live-restart full flow: after the stack restarts the workflow, project and run history are intact', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const state = JSON.parse(readFileSync(STATE, 'utf8')) as FlowState
  await logIn(page, state)
  await page.goto(state.editorUrl)
  await caption(
    page,
    '15 · After restarting the stack: workflow, project and generated code are all still there'
  )
  for (const name of ['When Speed changes 1', 'Stable for 1', 'Set IsSignaling 1'])
    await expect(nodeByName(page, name)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-sv-action="syncode"]')).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('[data-sv-action="export"]')).toBeEnabled()
  await page.getByRole('link', { name: 'Vehicle projects' }).click()
  const card = page.locator(`[data-sv-project="${state.slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 60_000 })
  await caption(page, 'SimVehicleApp — VSS blocks ⇒ Velocitas vehicle app, end to end')
  await pause(page, 3000)
})
