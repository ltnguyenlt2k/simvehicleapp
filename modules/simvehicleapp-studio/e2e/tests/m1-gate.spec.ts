import { expect, type Page, test } from '@playwright/test'

/**
 * M1 acceptance gate (analysis/phases/M01-studio-shell.md): sign up → create a workflow → reload and
 * still see it; plus structural (ARIA) snapshots of the vehicle editor chrome (T10) and the empty
 * toolbar (T05). One user per run, unique e-mail, so the test is repeatable on the same database.
 */
const run = Date.now().toString(36)
const user = {
  name: 'Playwright Tester',
  email: `e2e-${run}@example.com`,
  password: `E2e-${run}-Password!`,
}

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.locator('#name').fill(user.name)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\/[^/]+\/w(\/|$|\?)/, { timeout: 60_000 })
}

test.describe.serial('M1 gate', () => {
  let workflowUrl = ''

  test('sign-up lands in a workspace branded SimVehicleApp', async ({ page }) => {
    await signUp(page)
    await expect(page).toHaveTitle(/SimVehicleApp/)
    await expect(page.getByText('New chat')).toHaveCount(0)
  })

  test('creates a workflow and finds it again after reload', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill(user.email)
    await page.locator('#password').fill(user.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/workspace\//, { timeout: 60_000 })

    await page.getByRole('button', { name: 'New workflow' }).first().click()
    await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
    workflowUrl = page.url()
    const workflowId = new URL(workflowUrl).pathname.split('/').pop()

    await page.reload()
    await expect(page).toHaveURL(workflowUrl)
    await expect(page.locator(`a[href$="/w/${workflowId}"]`).first()).toBeVisible()
  })

  test('editor shows the vehicle chrome and an empty toolbar', async ({ page }) => {
    test.skip(!workflowUrl, 'needs the workflow from the previous test')
    await page.goto('/login')
    await page.locator('#email').fill(user.email)
    await page.locator('#password').fill(user.password)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL(/\/workspace\//, { timeout: 60_000 })
    await page.goto(workflowUrl)

    await expect(page.locator('[data-sv="safety-banner"]')).toMatchAriaSnapshot(`
      - note: High-level vehicle apps on KUKSA — not a replacement for safety-critical (ASIL) systems.
    `)
    await expect(page.locator('[data-sv="action-bar"]')).toMatchAriaSnapshot(`
      - toolbar "Vehicle app actions":
        - button "Verify" [disabled]
        - button "Simulate" [disabled]
        - button "SynCode" [disabled]
        - button "Run" [disabled]
        - button "Stop" [disabled]
        - button "Open IDE" [disabled]
        - button "Export" [disabled]
    `)
    await expect(page.locator('[data-sv="bottom-dock"]')).toMatchAriaSnapshot(`
      - tablist "Vehicle app output":
        - tab "Problems" [selected]
        - tab "Simulation timeline"
        - tab "Run console"
        - tab "Signals"
        - tab "Build log"
      - tabpanel: Problems — coming in M4
    `)

    await page.locator('[data-tab-button="toolbar"]').click()
    const toolbar = page.locator('[data-tab-content="toolbar"]')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByText('Note', { exact: true })).toBeVisible()
    await expect(toolbar.getByText('Agent', { exact: true })).toHaveCount(0)
    await expect(toolbar.getByText('Slack', { exact: true })).toHaveCount(0)
    await expect(toolbar.getByText('Loop', { exact: true })).toHaveCount(0)
  })
})
