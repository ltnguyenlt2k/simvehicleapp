import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Browser, expect, type Page, test } from '@playwright/test'

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

/**
 * Better Auth allows 3 sign-ins per 10 s per IP: the login form is exercised once, later tests reuse
 * that session (two contexts with the same session for the realtime test).
 */
const SESSION = fileURLToPath(new URL('../.state/m1-session.json', import.meta.url))
mkdirSync(fileURLToPath(new URL('../.state', import.meta.url)), { recursive: true })

async function logIn(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\//, { timeout: 60_000 })
}

async function openEditor(browser: Browser, url: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: SESSION })).newPage()
  await page.goto(url)
  await expect(page.locator('.react-flow__renderer')).toBeVisible()
  return page
}

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.locator('#name').fill(user.name)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\/[^/]+\/w(\/|$|\?)/, { timeout: 60_000 })
}

test.describe
  .serial('M1 gate', () => {
    let workflowUrl = ''

    test('sign-up lands in a workspace branded SimVehicleApp', async ({ page }) => {
      await signUp(page)
      await expect(page).toHaveTitle(/SimVehicleApp/)
      await expect(page.getByText('New chat')).toHaveCount(0)
    })

    test('creates a workflow and finds it again after reload', async ({ page }) => {
      await logIn(page)
      await page.context().storageState({ path: SESSION })

      await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
      const before = new URL(page.url()).pathname

      // The sidebar '+' is icon-only; create through the command palette like a keyboard user.
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      const palette = page.getByRole('dialog')
      await palette.getByRole('combobox').fill('Create workflow')
      await palette.getByRole('option', { name: 'Create workflow' }).click()
      // Client-side navigation: poll the URL instead of waiting for a 'load' event.
      await expect(page).toHaveURL(
        (url) => /\/w\/[^/?]+$/.test(url.pathname) && url.pathname !== before,
        { timeout: 60_000 }
      )
      workflowUrl = page.url()
      const workflowId = new URL(workflowUrl).pathname.split('/').pop()

      await page.reload()
      await expect(page).toHaveURL(workflowUrl)
      await expect(page.locator(`a[href$="/w/${workflowId}"]`).first()).toBeVisible()
    })

    test('editor shows the vehicle chrome and an empty toolbar', async ({ browser }) => {
      test.skip(!workflowUrl, 'needs the workflow from the previous test')
      const page = await openEditor(browser, workflowUrl)

      await expect(page.locator('[data-sv="safety-banner"]')).toMatchAriaSnapshot(`
      - note: High-level vehicle apps on KUKSA — not a replacement for safety-critical (ASIL) systems.
    `)
      await expect(page.locator('[data-sv="action-bar"]')).toMatchAriaSnapshot(`
      - toolbar "Vehicle app actions":
        - button "Verify"
        - button "Simulate"
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
      - tabpanel "Problems"
    `)

      await page.locator('[data-tab-button="toolbar"]').click()
      const toolbar = page.locator('[data-tab-content="toolbar"]')
      await expect(toolbar).toBeVisible()
      await expect(toolbar.getByText('Note', { exact: true })).toBeVisible()
      await expect(toolbar.getByText('Agent', { exact: true })).toHaveCount(0)
      await expect(toolbar.getByText('Slack', { exact: true })).toHaveCount(0)
      // M03-T10: Sim's loop/parallel containers carry sv_repeat/sv_while/sv_parallel and are offered.
      await expect(toolbar.getByText('Loop', { exact: true })).toBeVisible()
    })

    test('realtime collaboration: a block added in one session appears in another', async ({
      browser,
    }) => {
      test.skip(!workflowUrl, 'needs the workflow from the previous test')
      const a = await openEditor(browser, workflowUrl)
      const b = await openEditor(browser, workflowUrl)
      const nodesInB = b.locator('.react-flow__node')
      const before = await nodesInB.count()

      await a.locator('[data-tab-button="toolbar"]').click()
      await a.locator('[data-tab-content="toolbar"]').getByText('Note', { exact: true }).click()

      await expect(nodesInB).toHaveCount(before + 1, { timeout: 30_000 })
      await a.context().close()
      await b.context().close()
    })
  })
