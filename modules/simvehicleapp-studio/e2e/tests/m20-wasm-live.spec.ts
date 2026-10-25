import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  deleteVehicleApps,
  dropSignal,
  dragFromToolbar,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/** Live runs create real vehicle apps: delete them, pass or fail (ADR-0053). */
test.afterEach(async ({ page }) => deleteVehicleApps(page))

/**
 * @live — needs the full dev stack with the WebAssembly backends (`COMPOSE_PROFILES=…,rust,wasm`,
 * `cpp-wasm=…`/`rust-wasm=…` in SV_BACKENDS/SV_TOOLCHAINS, see docs/user-guide/wasm.md), skipped in CI like
 * the other live specs.
 *
 * M20-T09 through the UI, for C++ and Rust: Vehicle apps offers the WebAssembly runtime ⇒ the app card says
 * `<language> · WebAssembly` ⇒ SynCode builds the module and runs the saved test case inside the guest ⇒
 * Export carries sv-app.json ⇒ Run starts sv-wasm-host on KUKSA (kuksa.val.v2) ⇒ injected speed switches
 * the hazard lights on ⇒ Flow shows the run the injection fired.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'

async function inject(page: Page, path: string, value: string) {
  const row = page.locator(`[data-sv-signal="${path}"]`)
  await row.getByRole('textbox', { name: `Value for ${path}` }).fill(value)
  await row.locator(`[data-sv-inject="${path}"]`).click()
}

/** Speed stable above 120 km/h for 2 s ⇒ hazard lights on, with a scenario that becomes the generated test. */
async function overspeedWorkflow(page: Page) {
  await dropSignal(page, SPEED, 'sv_on_signal_changed', 220, 260)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
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
  await dropSignal(page, HAZARD, 'sv_set_actuator', 1020, 260)
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
        'until: 6000',
        'initial:',
        `  ${SPEED}: 0`,
        `  ${HAZARD}: false`,
        'inputs:',
        `  - { t: 1000, path: ${SPEED}, value: 100 }`,
        `  - { t: 2000, path: ${SPEED}, value: 130 }`,
        'expect:',
        '  writes:',
        `    - { t: 4000, path: ${HAZARD}, value: true }`,
      ].join('\n')
    )
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.locator('[data-sv-action="simulate"]').click()
  await expect(
    page.locator('[data-sv="simulation-timeline"] [data-sv-sim-row="write"]')
  ).toHaveCount(1, { timeout: 30_000 })
}

test.use({ viewport: { width: 1920, height: 1080 } })

for (const { language, label, card } of [
  { language: 'cpp', label: 'C++', card: 'C++ · WebAssembly' },
  { language: 'rust', label: 'Rust (experimental)', card: 'Rust · WebAssembly' },
]) {
  test(`@live ${card} app: create ⇒ SynCode ⇒ Export ⇒ Run in sv-wasm-host ⇒ inject ⇒ hazard on ⇒ Flow`, async ({
    page,
  }) => {
    test.setTimeout(900_000)
    await signUp(page, newUser(`m20${language}`, `Playwright Wasm ${language === 'cpp' ? 'Cpp' : 'Rust'}`))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    const editorUrl = new URL(page.url()).pathname
    await overspeedWorkflow(page)

    // The Runtime choice appears because codegen-<lang>-wasm and toolchain-<lang>-wasm are up.
    await page.getByRole('link', { name: 'Vehicle apps' }).click()
    await page.getByRole('textbox', { name: 'App name' }).fill(`Wasm ${language} ${workflowId.slice(0, 6)}`)
    const slug = await page.getByRole('textbox', { name: 'App folder' }).inputValue()
    await page.getByLabel('Language').click()
    await page
      .getByRole('menuitem', { name: label })
      .or(page.getByRole('menuitemcheckbox', { name: label }))
      .click()
    await page.getByLabel('Runtime').click()
    await page
      .getByRole('menuitem', { name: 'WebAssembly (sv-wasm-host)' })
      .or(page.getByRole('menuitemcheckbox', { name: 'WebAssembly (sv-wasm-host)' }))
      .click()
    await page.locator('[data-sv="project-create-submit"]').click()
    const appCard = page.locator(`[data-sv-project="${slug}"]`)
    await expect(appCard.locator('[data-sv="project-status"]')).toHaveText('Ready', {
      timeout: 300_000,
    })
    await expect(appCard).toContainText(card)
    await appCard.locator(`[data-sv-workflow="${workflowId}"]`).click()

    await page.goto(editorUrl)
    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 30_000 })
    await syncode.click()
    const log = page.locator('[data-sv="build-log"]')
    await expect(log.locator('[data-sv="syncode-result"]')).toContainText('SynCode passed', {
      timeout: 600_000,
    })
    for (const key of ['ir', 'format', 'compile', 'tests']) {
      await expect(log.locator(`[data-sv-verify="${key}"]`)).toHaveAttribute(
        'data-sv-state',
        'passed'
      )
    }

    const workspaceId = editorUrl.split('/')[2]
    const listed = await page.request.get(`/api/sv/projects?workspaceId=${workspaceId}`)
    const projects = (await listed.json()) as {
      projects?: { id: string; slug: string; language: string; target?: string }[]
    }
    const project = projects.projects?.find((p) => p.slug === slug)
    expect(project).toMatchObject({ language, target: 'wasm' })

    // Export: the allowlist the host enforces and the README on building and running the module.
    const exportButton = page.locator('[data-sv-action="export"]')
    await expect(exportButton).toBeEnabled()
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
    const zip = readFileSync(await download.path()).toString('latin1')
    const entry = language === 'cpp' ? 'MainWasm.cpp' : 'app/src/generated/wasm.rs'
    for (const name of ['app/src/generated/sv-app.json', 'README.SIMVEHICLE.md', entry])
      expect(zip.includes(name), `${name} in the export`).toBe(true)

    // Run in sv-wasm-host on the real databroker, inject the speed, the hazard lights switch on.
    for (const field of ['target', 'value']) {
      await page.request.post(`/api/sv/projects/${project!.id}/signals`, {
        data: { path: HAZARD, value: false, field },
      })
    }
    await page.locator('[data-sv-action="run"]').click()
    await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute(
      'data-sv-state',
      'running',
      { timeout: 60_000 }
    )
    await page.locator('[data-sv-tab="live"]').click()
    await inject(page, SPEED, '100')
    await page.waitForTimeout(1000)
    await inject(page, SPEED, '130')
    await page.waitForTimeout(3000)
    await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-value]`)).toHaveText(
      'true',
      { timeout: 10_000 }
    )
    await expect(page.getByRole('log', { name: 'Run console' })).toContainText('Set IsSignaling 1', {
      timeout: 15_000,
    })

    // Flow (M19): the run the injected 130 fired, the stable branch and the write.
    await page.locator('[data-sv-live-pane="flow"]').click()
    const newest = page.locator('[data-sv-flow-run]').first()
    await expect(newest).toContainText(`${SPEED} = 130 (you injected)`, { timeout: 10_000 })
    await expect(newest.locator('[data-sv-flow-handle="stable"]')).toBeVisible()
    await expect(newest.locator(`[data-sv-flow-write="${HAZARD}"]`)).toBeVisible()
    await page.locator('[data-sv-live-pane="run-console"]').click()

    await page.locator('[data-sv-action="stop"]').click()
    await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute(
      'data-sv-state',
      'stopped',
      { timeout: 15_000 }
    )
  })
}
