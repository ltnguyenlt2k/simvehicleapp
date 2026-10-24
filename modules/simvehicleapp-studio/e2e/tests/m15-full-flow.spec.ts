import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  deleteVehicleApps,
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
 * Live runs create real vehicle apps: delete them (ADR-0053). A passing `@live` keeps its app for `@live-restart`,
 * which checks it survived the restart and then deletes it.
 */
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('@live full flow') && testInfo.status === 'passed') return
  await deleteVehicleApps(page)
})

/**
 * M15-T06 (SCENARIOS H2), updated for M16 — @live, the whole product on the real stack, one user, one workflow:
 * sign-up ⇒ a branching "overspeed warning" built by drag and drop (If/Else, Stable for, two actuators, HMI) ⇒
 * block summaries and branch labels ⇒ lint clean ⇒ Simulate ⇒ SynCode creates the vehicle app and builds it ⇒
 * Run on KUKSA ⇒ inject ⇒ hazard on + HMI, then off on the else branch ⇒ Vehicle apps and System status ⇒ Export
 * zip ⇒ Open IDE ⇒ assistant proposal accepted (fake provider) ⇒ after the stack restarts, `@live-restart` finds it
 * all again.
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
  await dropSignal(page, SPEED, 'sv_on_signal_changed', 120, 260)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
  await pause(page, 600)

  await caption(page, '3 · If / Else: is the speed above 120 km/h?')
  await dragFromToolbar(page, 'If / Else', 420, 260)
  const branch = nodeByName(page, 'If / Else 1')
  await expect(branch).toBeVisible()
  await branch.click()
  const ifCondition = subBlock(page, 'condition').locator('textarea').first()
  await ifCondition.fill('<whenspeedchanges1.value> > 120')
  await ifCondition.press('Escape')

  await caption(page, '4 · then ⇒ Stable for 2 s: the speed stays above 120 km/h')
  await dragFromToolbar(page, 'Stable for', 720, 140)
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

  await caption(page, '5 · stable ⇒ Hazard.IsSignaling = true, then an HMI warning')
  await dropSignal(page, HAZARD, 'sv_set_actuator', 1020, 140)
  const set = nodeByName(page, 'Set IsSignaling 1')
  await expect(set).toBeVisible()
  await set.click()
  const value = subBlock(page, 'value').locator('textarea').first()
  await value.fill('true')
  await value.press('Escape')
  await dragFromToolbar(page, 'HMI notification', 1020, 380)
  const hmi = nodeByName(page, 'HMI notification 1')
  await expect(hmi).toBeVisible()
  await hmi.click()
  const title = subBlock(page, 'title').locator('textarea').first()
  await title.fill('Overspeed')
  await title.press('Escape')
  const message = subBlock(page, 'message').locator('textarea').first()
  await message.fill('Speed <whenspeedchanges1.value> km/h')
  await message.press('Escape')

  await caption(page, '6 · else ⇒ Hazard.IsSignaling = false; connect the branches')
  await dropSignal(page, HAZARD, 'sv_set_actuator', 720, 460)
  const clear = nodeByName(page, 'Set IsSignaling 2')
  await expect(clear).toBeVisible()
  await clear.click()
  const off = subBlock(page, 'value').locator('textarea').first()
  await off.fill('false')
  await off.press('Escape')
  await connect(trigger, 'source', branch)
  await connect(branch, 'then', stable)
  await connect(branch, 'else', clear)
  await connect(stable, 'stable', set)
  await connect(set, 'source', hmi)

  await caption(
    page,
    '7 · The canvas reads like the logic: a sentence per block, labelled branches'
  )
  await expect(page.locator('[data-sv="block-problems"]')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.locator('[data-sv="block-summary"]')).toHaveCount(6)
  await expect(stable.locator('[data-sv="block-summary"]')).toContainText('holds for 2 s')
  await expect(set.locator('[data-sv="block-summary"]')).toContainText(
    'Set Hazard.IsSignaling = true'
  )
  await expect(hmi.locator('[data-sv="block-summary"]')).toContainText('HMI: Overspeed')
  expect((await page.locator('[data-sv="edge-label"]').allTextContents()).sort()).toEqual([
    'else',
    'stable',
    'then',
  ])
  await pause(page, 1500)

  await caption(page, '7 · Logic: the whole workflow as sentences — a sentence selects its block')
  await page.locator('[data-sv-view="logic"]').click()
  const logic = page.locator('[data-sv="logic-view"]')
  await expect(logic.locator('[data-sv-logic-line="branch"]')).toHaveCount(3)
  await logic.locator('[data-sv-logic-line="step"]', { hasText: 'holds for 2 s' }).click()
  await pause(page, 1500)
  await logic.getByRole('button', { name: 'Close Logic view' }).click()

  await caption(page, '8 · Simulate without building: 100 ⇒ off, 130 for 2 s ⇒ on + HMI, 90 ⇒ off')
  await page.locator('[data-sv-tab="simulation"]').click()
  await page.locator('[data-sv="scenario-editor"]').getByRole('button', { name: 'YAML' }).click()
  await page
    .getByRole('textbox', { name: 'Scenario YAML' })
    .fill(
      [
        'scenarioVersion: 1.0.0',
        'name: Overspeed',
        'until: 8000',
        'initial:',
        `  ${SPEED}: 0`,
        `  ${HAZARD}: false`,
        'inputs:',
        `  - { t: 1000, path: ${SPEED}, value: 100 }`,
        `  - { t: 2000, path: ${SPEED}, value: 130 }`,
        `  - { t: 6000, path: ${SPEED}, value: 90 }`,
      ].join('\n')
    )
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.locator('[data-sv-action="simulate"]').click()
  const write = page.locator('[data-sv="simulation-timeline"] [data-sv-sim-row="write"]')
  await expect(write).toHaveCount(3, { timeout: 30_000 })
  await expect(write.nth(1)).toContainText('4000')
  const cursor = page.getByRole('slider', { name: 'Replay time' })
  for (const t of ['1000', '2000', '4000', '6000']) {
    await cursor.fill(t)
    await pause(page, 600)
  }
  await expect(set.locator('[data-sv="trace-badge"]')).toHaveAttribute('data-sv-replay', 'done')

  await caption(page, '9 · SynCode: the workflow has no vehicle app yet — name it once')
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(page.locator('[data-sv="action-hint"]')).toContainText('press SynCode to create one')
  await expect(syncode).toHaveAttribute('data-sv-primary', 'true')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(`Overspeed ${workflowId.slice(0, 6)}`)
  await pause(page, 1000)
  await dialog.getByRole('button', { name: 'Create and SynCode' }).click()
  await expect(syncode).toHaveText('Preparing app…')
  await caption(
    page,
    '10 · The app is prepared, then SynCode runs by itself: graph ⇒ IR ⇒ C++ ⇒ build ⇒ tests'
  )
  await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText(
    'SynCode passed',
    { timeout: 600_000 }
  )
  await expect(page.locator('[data-sv="status-pill"]')).toContainText('Built ✓')
  const run = page.locator('[data-sv-action="run"]')
  await expect(run).toHaveAttribute('data-sv-primary', 'true')
  const slug = (await page.locator('[data-sv="app-chip"]').getAttribute('data-sv-project')) ?? ''
  expect(slug).toMatch(/^overspeed-/)
  await pause(page, 1500)

  await caption(page, '11 · Run on the KUKSA databroker, inject the speed from the Signals panel')
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
  await run.click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running', {
    timeout: 60_000,
  })
  await expect(page.locator('[data-sv="status-pill"]')).toContainText('Running')
  await page.locator('[data-sv-tab="live"]').click()
  // The current value: mirrored from the target (sdv.databroker.v1) or published by the gateway as provider of a
  // kuksa.val.v2 app (ADR-0047) — the app's write either way.
  const hazardTarget = page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-value]`)
  await inject(page, SPEED, '100')
  await pause(page, 800)
  await inject(page, SPEED, '130')
  await page.waitForTimeout(3000)
  await caption(page, '12 · Above 120 km/h for 2 s ⇒ hazard lights on and an HMI warning')
  await expect(hazardTarget).toHaveText('true')
  await page.locator('[data-sv-tab="live"]').click()
  const runConsole = page.getByRole('log', { name: 'Run console' })
  await expect(runConsole).toContainText('Set IsSignaling 1', { timeout: 15_000 })
  await expect(runConsole).toContainText('HMI notification 1')
  await pause(page, 1200)
  await page.locator('[data-sv-tab="live"]').click()
  await inject(page, SPEED, '90')
  await caption(page, '13 · Back to 90 km/h ⇒ the else branch switches them off')
  await expect(hazardTarget).toHaveText('false', { timeout: 10_000 })
  await pause(page, 1200)
  // Flow (M19-T04): the newest run was fired by the 90 the user injected and took the else branch.
  await page.locator('[data-sv-live-pane="flow"]').click()
  const newest = page.locator('[data-sv-flow-run]').first()
  await expect(newest).toContainText(`${SPEED} = 90 (you injected)`, { timeout: 10_000 })
  await expect(newest.locator('[data-sv-flow-handle="else"]')).toBeVisible()
  await pause(page, 1500)
  await page.locator('[data-sv-live-pane="run-console"]').click()
  await page.locator('[data-sv-tab="live"]').click()
  await page.locator('[data-sv-action="stop"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'stopped', {
    timeout: 15_000,
  })

  await caption(
    page,
    '13 · Deploy: the same app on a vehicle databroker — signals from the car, not simulated'
  )
  await page.locator('[data-sv-action="deploy"]').click()
  const deployDialog = page.getByRole('dialog')
  await deployDialog.getByPlaceholder('HIL bench').fill('Bench (stack databroker)')
  await deployDialog.getByPlaceholder('bench.lab:55555').fill('databroker:55555')
  await deployDialog.locator('[data-sv="deploy-test"]').click()
  await expect(deployDialog.locator('[data-sv="deploy-tested"]')).toContainText('Reachable', {
    timeout: 30_000,
  })
  await pause(page, 2000)
  await page.keyboard.press('Escape')

  await caption(
    page,
    '14 · Vehicle apps: the app, its size, quota and free disk; Clean / Delete / Repair'
  )
  await page.getByRole('link', { name: 'Vehicle apps' }).click()
  const card = page.locator(`[data-sv-project="${slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready')
  await expect(card).toContainText(/\d+(\.\d+)? MB/, { timeout: 30_000 })
  await expect(page.locator('[data-sv="capacity-apps"]')).toHaveText('1/10 apps in this workspace')
  await card.locator('[data-sv="project-actions"]').click()
  await expect(page.locator('[data-sv="project-delete"]')).toBeVisible()
  await pause(page, 1500)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: 'System status' }).click()
  await expect(page.locator('[data-sv="capacity-disk-card"]')).toBeVisible({ timeout: 30_000 })
  await caption(
    page,
    '14 · System status: services, disk level, apps against quotas, SynCode queue'
  )
  await pause(page, 1500)
  await page.goto(editorUrl)

  await caption(
    page,
    '15 · Export: the Velocitas project as a zip, with notices and the workflow graph'
  )
  const exportButton = page.locator('[data-sv-action="export"]')
  await expect(exportButton).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toBe(`${slug}.zip`)
  const zip = readFileSync(await download.path()).toString('latin1')
  for (const name of ['.simvehicleapp/workflows/', 'THIRD-PARTY-NOTICES', 'app/src/generated/'])
    expect(zip).toContain(name)
  await pause(page, 800)

  await caption(page, '16 · Open IDE: VS Code (code-server) on the same project')
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
  await caption(page, '16 · Open IDE: VS Code (code-server) on the same project')
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
    '17 · Assistant (offline fake provider): proposes a second behaviour as a patch'
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
  await caption(page, '18 · Review on the canvas, then Accept — the user stays in control')
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
    '19 · After restarting the stack: workflow, app and generated code are all still there'
  )
  for (const name of [
    'When Speed changes 1',
    'If / Else 1',
    'Stable for 1',
    'Set IsSignaling 1',
    'Set IsSignaling 2',
    'HMI notification 1',
  ])
    await expect(nodeByName(page, name)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-sv="app-chip"]')).toHaveAttribute(
    'data-sv-project',
    state.slug,
    {
      timeout: 60_000,
    }
  )
  await expect(page.locator('[data-sv-action="syncode"]')).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('[data-sv-action="export"]')).toBeEnabled()
  await page.getByRole('link', { name: 'Vehicle apps' }).click()
  const card = page.locator(`[data-sv-project="${state.slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 60_000 })
  await caption(page, 'SimVehicleApp — VSS blocks ⇒ Velocitas vehicle app, end to end')
  await pause(page, 3000)
})
