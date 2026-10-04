import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * M2 acceptance gate (analysis/phases/M02-vss-catalog-and-vehicle-blocks.md): the Vehicle panel
 * shows the VSS tree from vss-catalog (M02-T10: drag Speed → Read, a sensor offers no Set) and a
 * minimal workflow "When Speed changes → Set Hazard.IsSignaling = true" survives a studio restart.
 * Tests tagged @after-restart run in a second Playwright invocation after CI restarts the studio.
 */
const STATE_FILE = fileURLToPath(new URL('../.state/m2.json', import.meta.url))
const run = Date.now().toString(36)
const user = {
  name: 'Playwright Vehicle',
  email: `e2e-m2-${run}@example.com`,
  password: `E2e-${run}-Password!`,
}

interface GateState {
  email: string
  password: string
  workflowUrl: string
}

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.locator('#name').fill(user.name)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\//, { timeout: 60_000 })
}

async function createWorkflow(page: Page): Promise<string> {
  const before = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Search' }).click()
  const palette = page.getByRole('dialog')
  await palette.getByRole('combobox').fill('Create workflow')
  await palette.getByRole('option', { name: 'Create workflow' }).click()
  await expect(page).toHaveURL(
    (url) => /\/w\/[^/?]+$/.test(url.pathname) && url.pathname !== before,
    { timeout: 60_000 }
  )
  await expect(page.locator('.react-flow__renderer')).toBeVisible()
  return page.url()
}

async function openVehiclePanel(page: Page): Promise<Locator> {
  await page.locator('[data-tab-button="toolbar"]').click()
  const panel = page.locator('[data-sv="vehicle-panel"]')
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Search the Vehicle panel and return the row of `path`. Adding a block switches the side panel to
 * the Editor tab (Sim behaviour), so the Toolbar tab is reopened first.
 */
async function findSignal(page: Page, query: string, path: string): Promise<Locator> {
  const panel = await openVehiclePanel(page)
  await panel.getByRole('textbox', { name: 'Search vehicle signals' }).fill(query)
  const row = panel.locator(`[data-sv-panel-path="${path}"]`)
  await expect(row).toBeVisible()
  return row
}

/** Drag a signal row onto the canvas at (x, y) and return the opened block menu. */
async function dropSignal(page: Page, row: Locator, x: number, y: number): Promise<Locator> {
  await row.locator('[draggable="true"]').dragTo(page.locator('.react-flow__pane'), {
    targetPosition: { x, y },
  })
  const menu = page.locator('[data-sv="signal-drop-menu"]')
  await expect(menu).toBeVisible()
  return menu
}

const node = (page: Page, name: string) =>
  page.locator('.react-flow__node').filter({ hasText: name }).first()

test.describe.serial('M2 gate', () => {
  test('Vehicle panel: drag Speed → Read; a sensor offers no Set (M02-T10)', async ({ page }) => {
    await signUp(page)
    await createWorkflow(page)
    const panel = await openVehiclePanel(page)

    // Lazy tree from vss-catalog: top level lists branches below Vehicle.
    await expect(panel.locator('[data-sv-panel-path="Vehicle.Cabin"]')).toBeVisible()
    await expect(panel.locator('[data-sv="vss-release-picker"]')).toBeVisible()

    const speed = await findSignal(page, 'Vehicle.Speed', 'Vehicle.Speed')
    await expect(speed).toContainText('float · km/h')
    const menu = await dropSignal(page, speed, 300, 200)
    await expect(menu.locator('[data-sv-block]')).toHaveText(['Read', 'When changes'])
    await expect(menu.getByText('Set', { exact: true })).toHaveCount(0)

    await menu.locator('[data-sv-block="sv_read_signal"]').click()
    await expect(node(page, 'Read Speed')).toBeVisible()
  })

  test('workflow "When Speed changes → Set Hazard.IsSignaling = true" is saved', async ({ page }) => {
    await logIn(page, user.email, user.password)
    const workflowUrl = await createWorkflow(page)

    const speed = await findSignal(page, 'Vehicle.Speed', 'Vehicle.Speed')
    await (await dropSignal(page, speed, 200, 200)).locator('[data-sv-block="sv_on_signal_changed"]').click()
    const trigger = node(page, 'When Speed changes')
    await expect(trigger).toBeVisible()

    const hazard = await findSignal(
      page,
      'Hazard IsSignaling',
      'Vehicle.Body.Lights.Hazard.IsSignaling'
    )
    const hazardMenu = await dropSignal(page, hazard, 600, 200)
    await expect(hazardMenu.locator('[data-sv-block]')).toHaveText(['Read', 'When changes', 'Set'])
    await hazardMenu.locator('[data-sv-block="sv_set_actuator"]').click()
    const set = node(page, 'Set IsSignaling')
    await expect(set).toBeVisible()

    // Control edge trigger → set. Sim auto-connects a dropped block to the previous one; connect by
    // hand only when it did not (Sim handle ids, ADR-0011 Notes).
    const editor = page.locator('[data-tab-content="editor"]')
    if ((await page.locator('.react-flow__edge').count()) === 0) {
      await page.getByRole('button', { name: 'Fit view' }).click().catch(() => {})
      await trigger
        .locator('[data-handleid="source"]')
        .dragTo(set.locator('[data-handleid="target"]'), { force: true })
    }
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    await set.click()
    await expect(editor.getByText('When Speed changes', { exact: false })).toBeVisible()

    // Configure: the path is locked to the dropped signal; value is a boolean pick.
    await expect(
      editor.locator('[data-sv="vss-path-card"][data-sv-path="Vehicle.Body.Lights.Hazard.IsSignaling"]')
    ).toBeVisible()
    // `value` is an SVX expression (M03-T08); boolean actuators offer quick picks.
    const value = editor.locator('[data-workflow-search-subblock-id="value"]')
    await value.locator('[data-sv-quick-value="true"]').click()
    await expect(value.locator('textarea')).toHaveValue('true')

    // M03-T11: the gate workflow built on the canvas has no lint problems.
    await page.locator('[data-sv-tab="problems"]').click()
    await expect(page.locator('[data-sv="problems"]')).toContainText('No problems', { timeout: 20_000 })

    await page.reload()
    await expect(node(page, 'When Speed changes')).toBeVisible()
    await expect(node(page, 'Set IsSignaling')).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    mkdirSync(dirname(STATE_FILE), { recursive: true })
    const state: GateState = { email: user.email, password: user.password, workflowUrl }
    writeFileSync(STATE_FILE, JSON.stringify(state))
  })

  test('switching the workflow to VSS v4.2 changes the tree without a rebuild (DoD)', async ({
    page,
  }) => {
    const v42Only = 'Vehicle.Powertrain.TractionBattery.Charging.ChargePortPosition'
    await logIn(page, user.email, user.password)
    await createWorkflow(page)
    const panel = await openVehiclePanel(page)
    const picker = panel.locator('[data-sv="vss-release-picker"]')
    await expect(picker).toContainText('v4.0')

    const search = panel.getByRole('textbox', { name: 'Search vehicle signals' })
    await search.fill('charge port position')
    await expect(panel.getByText('Searching…')).toHaveCount(0)
    await expect(panel.locator(`[data-sv-panel-path="${v42Only}"]`)).toHaveCount(0)

    await picker.getByRole('button').click()
    await page.getByRole('menuitem', { name: 'v4.2' }).click()
    await expect(picker).toContainText('v4.2')
    await expect(panel.locator(`[data-sv-panel-path="${v42Only}"]`)).toBeVisible()

    await page.reload()
    await expect((await openVehiclePanel(page)).locator('[data-sv="vss-release-picker"]')).toContainText(
      'v4.2'
    )
  })

  test('@after-restart the gate workflow is unchanged after restarting the studio', async ({
    page,
  }) => {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as GateState
    await logIn(page, state.email, state.password)
    await page.goto(state.workflowUrl)
    const trigger = node(page, 'When Speed changes')
    const set = node(page, 'Set IsSignaling')
    await expect(trigger).toBeVisible()
    await expect(set).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    await trigger.click()
    const editor = page.locator('[data-tab-content="editor"]')
    await expect(editor.locator('[data-sv="vss-path-card"][data-sv-path="Vehicle.Speed"]')).toBeVisible()
    await set.click()
    await expect(editor.locator('[data-workflow-search-subblock-id="value"] textarea')).toHaveValue('true')
  })
})
