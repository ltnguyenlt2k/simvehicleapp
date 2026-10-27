import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  deleteVehicleApps,
  dragFromToolbar,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/** Live runs create real vehicle apps: delete them, pass or fail (ADR-0053). */
test.afterEach(async ({ page }) => deleteVehicleApps(page))

/**
 * @live showcase (M21 D16) — every feature of the product on the real stack, on a workflow made of two workflows:
 * a function workflow "Safety check" (When called ⇒ Get variable ⇒ If / Else ⇒ Set variable result) and an
 * "Overspeed assistant" that calls it (Call workflow, ADR-0063) from a speed trigger, holds the result for 2 s
 * (Stable for), switches the hazard lights and warns on the HMI, and publishes telemetry every second over MQTT.
 * Then: Logic view and Auto layout ⇒ Test tab (Generate tests, coverage, Simulate all) ⇒ SynCode ⇒ Run on KUKSA,
 * inject, Flow, Messages ⇒ Deploy as a container image + Eclipse Kanto descriptor ⇒ Vehicle apps with the
 * WebAssembly runtime ⇒ System status ⇒ Export ⇒ IDE ⇒ assistant.
 *
 * Needs a registry on sv-internal named `sv-demo-registry` (`scripts/sv demo-video --showcase` starts one).
 * `SV_DEMO=1` records the video with captions and pauses.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const DEMO = process.env.SV_DEMO === '1'
const REGISTRY = process.env.SV_DEMO_REGISTRY ?? 'sv-demo-registry:5000'

test.use({
  viewport: { width: 1920, height: 1080 },
  video: DEMO ? { mode: 'on', size: { width: 1920, height: 1080 } } : 'off',
  launchOptions: { slowMo: DEMO ? 40 : 0 },
  // A step that cannot happen fails in 30 s instead of waiting for the whole test timeout.
  actionTimeout: 30_000,
})

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

/** Picks `label` in the dropdown sub-block `id` of the selected block (Sim lower-cases labels). */
async function pick(page: Page, id: string, label: string) {
  const sb = subBlock(page, id)
  await sb.getByRole('combobox').click()
  await page.getByRole('option', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') }).first().click()
}

async function setText(page: Page, id: string, value: string) {
  const ta = subBlock(page, id).locator('textarea').first()
  await ta.fill(value)
  await ta.press('Escape')
}

async function add(page: Page, toolbarName: string, x: number, y: number, name: string): Promise<Locator> {
  await dragFromToolbar(page, toolbarName, x, y)
  const node = nodeByName(page, name)
  await expect(node).toBeVisible()
  await node.click()
  return node
}

/** Opens the ChipModal dropdown showing `current` inside `scope` and picks `option`. */
async function choose(page: Page, scope: Locator, current: string, option: string) {
  await scope.getByRole('button', { name: current, exact: true }).or(scope.getByText(current, { exact: true })).first().click()
  await page
    .getByRole('menuitem', { name: option })
    .or(page.getByRole('menuitemcheckbox', { name: option }))
    .or(page.getByRole('option', { name: option }))
    .or(page.getByText(option, { exact: true }))
    .first()
    .click()
}

test('@live showcase: two workflows, Test, SynCode, Run, Flow, image + Kanto, WebAssembly, Export, IDE, assistant', async ({
  page,
}) => {
  test.setTimeout(1_800_000)
  const user = newUser('showcase', 'Demo Engineer')
  await page.goto('/signup')
  await caption(page, '1 · Sign up — the whole product runs in Docker Compose on this machine')
  await signUp(page, user)
  await setAutoConnect(page, false)
  await page.reload()

  // ── A function workflow: Safety check(speed) → result ───────────────────────────────────────────────────
  const fnId = await createWorkflow(page)
  const fnUrl = new URL(page.url()).pathname
  await page.request.put(`/api/workflows/${fnId}`, { data: { name: 'Safety check' } })
  await page.request.post(`/api/workflows/${fnId}/variables`, {
    data: {
      variables: {
        speed: { id: 'speed', name: 'speed', type: 'number', value: 0 },
        result: { id: 'result', name: 'result', type: 'boolean', value: false },
      },
    },
  })
  await page.reload()
  await caption(page, '2 · A function workflow "Safety check": variables speed (in) and result (out)')
  const called = await add(page, 'When called', 120, 260, 'When called 1')
  const read = await add(page, 'Get variable', 420, 260, 'Get variable 1')
  await pick(page, 'name', 'speed')
  const check = await add(page, 'If / Else', 720, 260, 'If / Else 1')
  await setText(page, 'condition', '<getvariable1.value> > 120')
  const yes = await add(page, 'Set variable', 1020, 140, 'Set variable 1')
  await pick(page, 'name', 'result')
  await setText(page, 'value', 'true')
  const no = await add(page, 'Set variable', 1020, 420, 'Set variable 2')
  await pick(page, 'name', 'result')
  await setText(page, 'value', 'false')
  await connect(called, 'source', read)
  await connect(read, 'source', check)
  await connect(check, 'then', yes)
  await connect(check, 'else', no)
  await caption(page, '3 · result = speed > 120 km/h. It runs only when another workflow calls it')
  await pause(page, 2000)

  // ── The main workflow ───────────────────────────────────────────────────────────────────────────────────
  const mainId = await createWorkflow(page)
  const editorUrl = new URL(page.url()).pathname
  await page.request.put(`/api/workflows/${mainId}`, { data: { name: 'Overspeed assistant' } })
  await page.reload()
  await caption(page, '4 · Overspeed assistant: When Vehicle.Speed changes ⇒ Call workflow "Safety check"')
  await dropSignal(page, SPEED, 'sv_on_signal_changed', 40, 250)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
  const call = await add(page, 'Call workflow', 340, 250, 'Call workflow 1')
  await pick(page, 'workflowId', 'Safety check')
  const args = subBlock(page, 'args')
  await args.getByPlaceholder('name').first().fill('speed')
  await args.getByPlaceholder('value').first().fill('<whenspeedchanges1.value>')
  await args.getByPlaceholder('value').first().press('Tab')
  await pause(page, 800)

  await caption(page, '5 · If the function says "too fast" for 2 s ⇒ hazard lights on + HMI warning; else off')
  const branch = await add(page, 'If / Else', 640, 250, 'If / Else 1')
  await setText(page, 'condition', '<callworkflow1.value>')
  const stable = await add(page, 'Stable for', 940, 60, 'Stable for 1')
  await setText(page, 'condition', '<whenspeedchanges1.value> > 120')
  const duration = subBlock(page, 'durationMs').getByRole('textbox', { name: 'Duration' })
  await duration.fill('2000')
  await duration.press('Tab')
  await dropSignal(page, HAZARD, 'sv_set_actuator', 940, 260)
  const on = nodeByName(page, 'Set IsSignaling 1')
  await on.click()
  await setText(page, 'value', 'true')
  const hmi = await add(page, 'HMI notification', 640, 520, 'HMI notification 1')
  await setText(page, 'title', 'Overspeed')
  await setText(page, 'message', 'Speed <whenspeedchanges1.value> km/h')
  await dropSignal(page, HAZARD, 'sv_set_actuator', 940, 480)
  const off = nodeByName(page, 'Set IsSignaling 2')
  await off.click()
  await setText(page, 'value', 'false')
  await connect(trigger, 'source', call)
  await connect(call, 'source', branch)
  await connect(branch, 'then', stable)
  await connect(branch, 'else', off)
  await connect(stable, 'stable', on)
  await connect(on, 'source', hmi)

  await caption(page, '6 · A second trigger: every second, publish the speed as telemetry over MQTT')
  const timer = await add(page, 'Every …', 40, 640, 'Every … 1')
  const interval = subBlock(page, 'intervalMs').getByRole('textbox', { name: 'Duration' })
  await interval.fill('1000')
  await interval.press('Tab')
  const publish = await add(page, 'Publish MQTT', 340, 640, 'Publish MQTT 1')
  const topic = subBlock(page, 'topic').locator('input').first()
  await topic.fill('fleet/telemetry')
  await topic.press('Tab')
  await setText(page, 'payload', 'speed=<Vehicle.Speed>')
  await connect(timer, 'source', publish)
  await expect(page.locator('[data-sv="block-problems"]')).toHaveCount(0, { timeout: 30_000 })
  await pause(page, 1500)

  await caption(page, '7 · Auto layout: one lane per trigger — then Logic: the workflow as sentences')
  await page.locator('[data-sv="workflow-menu"]').click()
  await page.getByRole('menuitem', { name: 'Auto layout' }).click()
  await pause(page, 1500)
  await page.locator('[data-sv-view="logic"]').click()
  const logic = page.locator('[data-sv="logic-view"]')
  await expect(logic).toContainText('Call a workflow · 1 argument')
  await pause(page, 2500)
  await logic.getByRole('button', { name: 'Close Logic view' }).click()

  // ── Test tab ────────────────────────────────────────────────────────────────────────────────────────────
  await caption(page, '8 · Test: Generate tests derives cases from the branches; Simulate all, no build needed')
  await page.locator('[data-sv-tab="simulation"]').click()
  const tab = page.locator('[data-sv="test-tab"]')
  await tab.locator('[data-sv="test-generate"]').click()
  const cases = tab.locator('[data-sv="test-case"]')
  await expect.poll(() => cases.count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
  await expect(tab.locator('[data-sv="test-coverage"]')).toHaveText(/Branches covered: \d+ \/ \d+/)
  await tab.locator('[data-sv="test-simulate-all"]').click()
  await expect(tab.locator('[data-sv-outcome="passed"]')).toHaveCount(await cases.count(), { timeout: 60_000 })
  await pause(page, 2500)

  // ── SynCode and Run ─────────────────────────────────────────────────────────────────────────────────────
  await caption(page, '9 · SynCode: name the vehicle app once — graph ⇒ IR ⇒ C++ ⇒ build ⇒ the test cases run')
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill(`Overspeed ${mainId.slice(0, 6)}`)
  await pause(page, 800)
  await dialog.getByRole('button', { name: 'Create and SynCode' }).click()
  await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText('SynCode passed', {
    timeout: 900_000,
  })
  const slug = (await page.locator('[data-sv="app-chip"]').getAttribute('data-sv-project')) ?? ''
  await pause(page, 1500)

  await caption(page, '10 · Run on the KUKSA databroker; inject 100 then 130 km/h from the Signals panel')
  const workspaceId = editorUrl.split('/')[2]
  const listed = (await (await page.request.get(`/api/sv/projects?workspaceId=${workspaceId}`)).json()) as {
    projects?: { id: string; slug: string }[]
  }
  const projectId = listed.projects?.find((p) => p.slug === slug)?.id
  for (const field of ['target', 'value']) {
    await page.request.post(`/api/sv/projects/${projectId}/signals`, { data: { path: HAZARD, value: false, field } })
  }
  await page.locator('[data-sv-action="run"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running', { timeout: 60_000 })
  await page.locator('[data-sv-tab="live"]').click()
  const hazard = page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-value]`)
  await inject(page, SPEED, '100')
  await pause(page, 800)
  await inject(page, SPEED, '130')
  await page.waitForTimeout(3000)
  await caption(page, '11 · The function said "too fast" for 2 s ⇒ hazard lights on and an HMI warning')
  await expect(hazard).toHaveText('true', { timeout: 10_000 })
  await page.locator('[data-sv-live-pane="flow"]').click()
  await caption(page, '12 · Flow: each run, what fired it, the branch it took and why, what it wrote')
  await expect(page.locator('[data-sv-flow-run]').first()).toBeVisible({ timeout: 10_000 })
  await pause(page, 2500)
  await page.locator('[data-sv-live-pane="messages"]').click()
  await caption(page, '13 · Messages: the HMI warning and the telemetry published every second over MQTT')
  await pause(page, 3000)
  await page.locator('[data-sv-live-pane="run-console"]').click()
  await inject(page, SPEED, '90')
  await caption(page, '14 · Back to 90 km/h ⇒ the else branch switches them off')
  await expect(hazard).toHaveText('false', { timeout: 10_000 })
  await pause(page, 1500)
  await page.locator('[data-sv-action="stop"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'stopped', { timeout: 15_000 })

  // ── Deploy: container image + Eclipse Kanto ─────────────────────────────────────────────────────────────
  await caption(page, '15 · Deploy as a container image: built FROM scratch and pushed without Docker')
  await page.locator('[data-sv-action="deploy"]').click()
  const deploy = page.getByRole('dialog')
  await choose(page, deploy, 'Run it here on a vehicle databroker (bench, HIL, car)', 'Container image pushed to a registry (run it on the vehicle)')
  await deploy.getByPlaceholder('registry.lab:5000/vehicle/hazard:1.0').fill(`${REGISTRY}/demo/${slug}:1.0`)
  await choose(page, deploy, 'HTTPS', 'HTTP (a lab registry)')
  await pause(page, 800)
  await deploy.getByRole('button', { name: 'Push image' }).click()
  await expect(deploy.locator('[data-sv="image-pushed"]')).toContainText('sha256:', { timeout: 600_000 })
  await caption(page, '16 · Pushed by digest — and the Eclipse Kanto descriptor to run it on the vehicle')
  const [kanto] = await Promise.all([page.waitForEvent('download'), deploy.locator('[data-sv="kanto-descriptor"]').click()])
  const descriptor = JSON.parse(readFileSync(await kanto.path(), 'utf8')) as { image: { name: string } }
  expect(descriptor.image.name).toContain('@sha256:')
  await pause(page, 2000)
  await page.keyboard.press('Escape')

  // ── Vehicle apps: WebAssembly ───────────────────────────────────────────────────────────────────────────
  await caption(page, '17 · Vehicle apps: the same workflow can also become a WebAssembly app (C++ or Rust)')
  await page.getByRole('link', { name: 'Vehicle apps' }).click()
  await page.getByRole('textbox', { name: 'App name' }).fill('Overspeed wasm')
  await page.getByLabel('Language').click()
  await page.getByRole('menuitem', { name: 'Rust (experimental)' }).or(page.getByRole('menuitemcheckbox', { name: 'Rust (experimental)' })).first().click()
  await page.getByLabel('Runtime').click()
  await page
    .getByRole('menuitem', { name: 'WebAssembly (sv-wasm-host)' })
    .or(page.getByRole('menuitemcheckbox', { name: 'WebAssembly (sv-wasm-host)' }))
    .first()
    .click()
  await page.locator('[data-sv="project-create-submit"]').click()
  const wasmCard = page.locator('[data-sv-project="overspeed-wasm"]')
  await expect(wasmCard.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 300_000 })
  await expect(wasmCard).toContainText('Rust · WebAssembly')
  await pause(page, 2000)
  await page.getByRole('link', { name: 'System status' }).click()
  await caption(page, '18 · System status: every service, disk, apps against quotas, the SynCode queue')
  await expect(page.locator('[data-sv="capacity-disk-card"]')).toBeVisible({ timeout: 30_000 })
  await pause(page, 2000)

  // ── Export, IDE, assistant ──────────────────────────────────────────────────────────────────────────────
  await page.goto(editorUrl)
  await caption(page, '19 · Export: the Velocitas project as a zip, with notices and both workflow graphs')
  const exportButton = page.locator('[data-sv-action="export"]')
  await expect(exportButton).toBeEnabled({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  expect(download.suggestedFilename()).toBe(`${slug}.zip`)
  await pause(page, 800)

  await caption(page, '20 · Open IDE: VS Code (code-server) on the generated project')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-sv-action="open-ide"]').click()])
  await popup.waitForLoadState()
  const password = popup.locator('input[name="password"]')
  if (await password.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await password.fill(process.env.SV_IDE_PASSWORD ?? 'simvehicleapp')
    await password.press('Enter')
  }
  await expect(popup).toHaveURL(/folder=/, { timeout: 60_000 })
  const ideUrl = popup.url()
  await popup.close()
  await page.goto(ideUrl)
  await caption(page, '20 · Open IDE: the generated C++ of both workflows, readable and buildable')
  const explorer = page.locator('.explorer-folders-view')
  for (const folder of ['app', 'src', 'generated', 'workflows']) {
    const item = explorer.getByRole('treeitem', { name: folder, exact: true })
    await expect(item).toBeVisible({ timeout: 120_000 })
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
  // The generated C++ of the main workflow: the function workflow's blocks are inlined into it.
  const source = explorer.getByRole('treeitem', { name: /^OverspeedAssistant\.cpp$/ })
  await expect(source).toBeVisible({ timeout: 30_000 })
  await source.dblclick()
  await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('OverspeedAssistant', {
    timeout: 30_000,
  })
  await pause(page, 3500)

  await page.goto(editorUrl)
  await caption(page, '21 · Assistant (offline fake provider): proposes a change as a patch you review')
  await page.locator('[data-tab-button="copilot"]').click()
  const panel = page.locator('[data-sv-assistant="panel"]')
  const input = panel.getByRole('textbox', { name: 'Message the assistant' })
  await expect(input).toBeEnabled({ timeout: 20_000 })
  await input.fill('Warn on the HMI when the battery is below 20 % while driving')
  await input.press('Enter')
  const proposal = panel.locator('[data-sv-ai-proposal]')
  await expect(proposal).toBeVisible({ timeout: 120_000 })
  await proposal.locator('[data-sv-ai-preview]').click()
  await pause(page, 1500)
  await caption(page, '22 · Review on the canvas, then Accept — the user stays in control')
  await page.getByRole('button', { name: /^Accept/ }).click()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await pause(page, 2000)
  // The function workflow keeps its own canvas.
  await page.goto(fnUrl)
  await caption(page, '23 · The function workflow, reused by any workflow that calls it')
  await pause(page, 2500)
})
