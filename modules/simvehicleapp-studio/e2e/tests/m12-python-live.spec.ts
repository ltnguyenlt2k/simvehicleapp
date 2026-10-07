import { readFileSync } from 'node:fs'
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
 * @live — needs the full dev stack with the Python backend (`COMPOSE_PROFILES=python`, `python=…` in
 * SV_BACKENDS/SV_TOOLCHAINS, see .env.example), skipped in CI like the other live specs.
 *
 * M12-T06 through the UI: the Projects page offers Python when the stack runs its backend and toolchain;
 * a Python project gets the overspeed workflow (Stable for 2 s ⇒ hazard) ⇒ SynCode builds, format-checks
 * and tests it ⇒ Export is a Python project ⇒ Open IDE opens ide-python on it ⇒ Run starts `app/src/main.py` on
 * KUKSA ⇒ injected speed switches the hazard lights on.
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'

async function inject(page: Page, path: string, value: string) {
  const row = page.locator(`[data-sv-signal="${path}"]`)
  await row.getByRole('textbox', { name: `Value for ${path}` }).fill(value)
  await row.locator(`[data-sv-inject="${path}"]`).click()
}

test.use({ viewport: { width: 1920, height: 1080 } })

test('@live Python project: create ⇒ SynCode ⇒ Run on KUKSA ⇒ inject ⇒ hazard on', async ({
  page,
}) => {
  test.setTimeout(900_000)
  await signUp(page, newUser('m12py', 'Playwright Python'))
  await setAutoConnect(page, false)
  await page.reload()
  const workflowId = await createWorkflow(page)
  const editorUrl = new URL(page.url()).pathname

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

  // A scenario saved with the workflow becomes the project's generated pytest.
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
  ).toHaveCount(1, {
    timeout: 30_000,
  })

  // Python project: the language is offered because codegen-python and toolchain-python are up.
  await page.getByRole('link', { name: 'Vehicle projects' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill(`Python ${workflowId.slice(0, 6)}`)
  const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
  await page.getByLabel('Language').click()
  await page
    .getByRole('menuitem', { name: 'Python' })
    .or(page.getByRole('menuitemcheckbox', { name: 'Python' }))
    .click()
  await page.locator('[data-sv="project-create-submit"]').click()
  const card = page.locator(`[data-sv-project="${slug}"]`)
  await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', { timeout: 300_000 })
  await card.locator(`[data-sv-workflow="${workflowId}"]`).click()

  await page.goto(editorUrl)
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  const log = page.locator('[data-sv="build-log"]')
  await expect(log.locator('[data-sv="syncode-result"]')).toContainText('SynCode passed', {
    timeout: 300_000,
  })

  // Every verification passed: IR, ruff format/check, compile + VSS check, the generated pytest.
  for (const key of ['ir', 'format', 'compile', 'tests']) {
    await expect(log.locator(`[data-sv-verify="${key}"]`)).toHaveAttribute(
      'data-sv-state',
      'passed'
    )
  }
  await expect(log.getByRole('log', { name: 'Build log' })).toContainText(
    '[==========] 1 test from 1 test suite ran.'
  )

  const workspaceId = editorUrl.split('/')[2]
  const listed = await page.request.get(`/api/sv/projects?workspaceId=${workspaceId}`)
  const projects = (await listed.json()) as {
    projects?: { id: string; slug: string; language: string }[]
  }
  const project = projects.projects?.find((p) => p.slug === slug)
  expect(project?.language).toBe('python')

  // Export: the zip is a Python project with the Python README/notices (ADR-0031, ADR-0040).
  const exportButton = page.locator('[data-sv-action="export"]')
  await expect(exportButton).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
  const zip = readFileSync(await download.path()).toString('latin1')
  for (const name of [
    'app/src/generated/app.py',
    'app/src/main.py',
    'app/src/simvehicleapp-runtime/',
    'README.SIMVEHICLE.md',
  ])
    expect(zip).toContain(name)

  // Open IDE: ide-python (code-server) on the project folder, the generated module in the explorer.
  const openIde = page.locator('[data-sv-action="open-ide"]')
  await expect(openIde).toBeEnabled()
  const [ide] = await Promise.all([page.waitForEvent('popup'), openIde.click()])
  await ide.waitForLoadState()
  expect(new URL(ide.url()).port).toBe(process.env.SV_IDE_PYTHON_PORT ?? '8081')
  const password = ide.locator('input[name="password"]')
  if (await password.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await password.fill(process.env.SV_IDE_PASSWORD ?? 'simvehicleapp')
    await password.press('Enter')
  }
  expect(decodeURIComponent(ide.url())).toContain(`folder=/workspace/projects/${slug}`)
  const explorer = ide.locator('.explorer-folders-view')
  for (const folder of ['app', 'src', 'generated']) {
    const item = explorer.getByRole('treeitem', { name: folder, exact: true })
    await expect(item).toBeVisible({ timeout: 120_000 })
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
  const source = explorer.getByRole('treeitem', { name: 'app.py', exact: true })
  await expect(source).toBeVisible()
  await source.dblclick()
  await expect(ide.locator('.monaco-editor .view-lines').first()).toContainText('WORKFLOWS', {
    timeout: 30_000,
  })
  await ide.close()

  // Run app/src/main.py on the real databroker, inject the speed, the hazard lights switch on.
  for (const field of ['target', 'value']) {
    await page.request.post(`/api/sv/projects/${project!.id}/signals`, {
      data: { path: HAZARD, value: false, field },
    })
  }
  await page.locator('[data-sv-action="run"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running', {
    timeout: 60_000,
  })
  await page.locator('[data-sv-tab="signals"]').click()
  await inject(page, SPEED, '100')
  await page.waitForTimeout(1000)
  await inject(page, SPEED, '130')
  await page.waitForTimeout(3000)
  await expect(page.locator(`[data-sv-signal="${HAZARD}"] [data-sv-signal-target]`)).toHaveText(
    'true'
  )
  await page.locator('[data-sv-tab="run-console"]').click()
  await expect(page.getByRole('log', { name: 'Run console' })).toContainText('Set IsSignaling 1', {
    timeout: 15_000,
  })
  await page.locator('[data-sv-action="stop"]').click()
  await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'stopped', {
    timeout: 15_000,
  })
})
