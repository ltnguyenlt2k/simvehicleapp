import { expect, type Page, test } from '@playwright/test'

/**
 * M03-T07/T08 on the real canvas: M3 blocks are offered by the toolbar, flow blocks show their named
 * branch handles instead of Sim's source/error pair, and the SVX/duration editors render.
 */
const run = Date.now().toString(36)
const user = { name: 'Playwright Logic', email: `e2e-m3-${run}@example.com`, password: `E2e-${run}-Password!` }

async function signUpAndCreateWorkflow(page: Page) {
  await page.goto('/signup')
  await page.locator('#name').fill(user.name)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
  const before = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Search' }).click()
  const palette = page.getByRole('dialog')
  await palette.getByRole('combobox').fill('Create workflow')
  await palette.getByRole('option', { name: 'Create workflow' }).click()
  await expect(page).toHaveURL((url) => /\/w\/[^/?]+$/.test(url.pathname) && url.pathname !== before, {
    timeout: 60_000,
  })
  await expect(page.locator('.react-flow__renderer')).toBeVisible()
}

/** Click a toolbar item (adds it at the viewport centre) and return the new node. */
async function addFromToolbar(page: Page, name: string) {
  await page.locator('[data-tab-button="toolbar"]').click()
  const toolbar = page.locator('[data-tab-content="toolbar"]')
  await toolbar.getByText(name, { exact: true }).first().click()
  const node = page.locator('.react-flow__node').filter({ hasText: name }).first()
  await expect(node).toBeVisible()
  return node
}

test.describe.serial('M3 blocks on the canvas', () => {
  test('flow blocks expose named branch handles; editors render (M03-T07/T08)', async ({ page }) => {
    await signUpAndCreateWorkflow(page)

    const toolbar = page.locator('[data-tab-content="toolbar"]')
    await page.locator('[data-tab-button="toolbar"]').click()
    for (const name of ['When app starts', 'Every …', 'If / Else', 'Wait', 'Expression', 'Publish MQTT']) {
      await expect(toolbar.getByText(name, { exact: true }).first()).toBeVisible()
    }

    const ifElse = await addFromToolbar(page, 'If / Else')
    await expect(ifElse.locator('[data-handleid="target"]')).toHaveCount(1)
    await expect(ifElse.locator('[data-handleid="then"]')).toHaveCount(1)
    await expect(ifElse.locator('[data-handleid="else"]')).toHaveCount(1)
    await expect(ifElse.locator('[data-handleid="error"]')).toHaveCount(0)
    await expect(ifElse.locator('[data-handleid="source"]')).toHaveCount(0)

    // Condition editor = SVX editor with the vehicle signal picker.
    await ifElse.click()
    const editor = page.locator('[data-tab-content="editor"]')
    const condition = editor.locator('[data-workflow-search-subblock-id="condition"]')
    await expect(condition.locator('[data-sv="svx-editor"]')).toBeVisible()
    await condition.locator('textarea').fill('<Vehicle.Speed> > 120 km/h')
    await expect(condition.locator('textarea')).toHaveValue('<Vehicle.Speed> > 120 km/h')

    const wait = await addFromToolbar(page, 'Wait')
    await expect(wait.locator('[data-handleid="error"]')).toHaveCount(0)
    await wait.click()
    const duration = editor.locator('[data-workflow-search-subblock-id="durationMs"]')
    await duration.getByRole('textbox', { name: 'Duration' }).fill('2')
    await duration.getByRole('button').last().click()
    await page.getByRole('menuitem', { name: 's', exact: true }).click()
    await expect(duration.getByRole('textbox', { name: 'Duration' })).toHaveValue('2')

    const stop = await addFromToolbar(page, 'Stop')
    await expect(stop.locator('[data-handleid="target"]')).toHaveCount(1)
    await expect(stop.locator('.react-flow__handle-right')).toHaveCount(0)
  })
})
