import { expect, type Locator, type Page } from '@playwright/test'

/** Shared Playwright helpers for the SimVehicleApp studio (sign-up, workflows, canvas, editor). */

export interface TestUser {
  name: string
  email: string
  password: string
}

export function newUser(prefix: string, name: string): TestUser {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
  return { name, email: `e2e-${prefix}-${run}@example.com`, password: `E2e-${run}-Password!` }
}

export async function signUp(page: Page, user: TestUser) {
  await page.goto('/signup')
  await page.locator('#name').fill(user.name)
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
}

export async function logIn(page: Page, user: Pick<TestUser, 'email' | 'password'>) {
  await page.goto('/login')
  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/workspace\//, { timeout: 60_000 })
}

/** Sim auto-connects a new block to the closest one; tests that wire every edge turn it off. */
export async function setAutoConnect(page: Page, enabled: boolean) {
  const res = await page.request.patch('/api/users/me/settings', { data: { autoConnect: enabled } })
  expect(res.ok(), `PATCH settings → ${res.status()}`).toBeTruthy()
}

/** Creates a workflow from the command palette and returns its id (URL captured after it settles). */
export async function createWorkflow(page: Page): Promise<string> {
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 60_000 })
  const before = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const palette = page.getByRole('dialog')
  await palette.getByRole('combobox').fill('Create workflow')
  await palette.getByRole('option', { name: 'Create workflow' }).click()
  await expect(page).toHaveURL(
    (url) => /\/w\/[^/?]+$/.test(url.pathname) && url.pathname !== before,
    { timeout: 60_000 }
  )
  await expect(page.locator('.react-flow__renderer')).toBeVisible()
  return workflowIdOf(page)
}

export function workflowIdOf(page: Page): string {
  const m = /\/w\/([^/?]+)/.exec(new URL(page.url()).pathname)
  if (!m) throw new Error(`not a workflow URL: ${page.url()}`)
  return m[1]
}

export const pane = (page: Page) => page.locator('.react-flow__pane')
export const editor = (page: Page) => page.locator('[data-tab-content="editor"]')
export const subBlock = (page: Page, id: string) =>
  editor(page).locator(`[data-workflow-search-subblock-id="${id}"]`)

/** Canvas node by its exact block name. */
export function nodeByName(page: Page, name: string): Locator {
  return page
    .locator('.react-flow__node')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
}

export async function openToolbar(page: Page): Promise<Locator> {
  await page.locator('[data-tab-button="toolbar"]').click()
  const toolbar = page.locator('[data-tab-content="toolbar"]')
  await expect(toolbar).toBeVisible()
  return toolbar
}

/** Drags a toolbar block onto the canvas at pane coordinates (x, y). */
export async function dragFromToolbar(page: Page, blockName: string, x: number, y: number) {
  const toolbar = await openToolbar(page)
  const item = toolbar.getByRole('button', { name: `Add ${blockName}`, exact: true }).first()
  await item.scrollIntoViewIfNeeded()
  // force: on an empty canvas the hint overlay sits above the pane and forwards the drop (as for a user)
  await item.dragTo(pane(page), { targetPosition: { x, y }, force: true })
}

export async function openVehiclePanel(page: Page): Promise<Locator> {
  await page.locator('[data-tab-button="toolbar"]').click()
  const panel = page.locator('[data-sv="vehicle-panel"]')
  await expect(panel).toBeVisible()
  return panel
}

/** Searches the Vehicle panel and returns the row of `path`. */
export async function findSignal(page: Page, path: string, query = path): Promise<Locator> {
  const panel = await openVehiclePanel(page)
  await panel.getByRole('textbox', { name: 'Search vehicle signals' }).fill(query)
  const row = panel.locator(`[data-sv-panel-path="${path}"]`)
  await expect(row).toBeVisible()
  return row
}

/** Drags a signal row onto the canvas at (x, y) and picks a block from the drop menu. */
export async function dropSignal(
  page: Page,
  path: string,
  blockType: string,
  x: number,
  y: number
) {
  const row = await findSignal(page, path)
  await row
    .locator('[draggable="true"]')
    .dragTo(pane(page), { targetPosition: { x, y }, force: true })
  const menu = page.locator('[data-sv="signal-drop-menu"]')
  await expect(menu).toBeVisible()
  await menu.locator(`[data-sv-block="${blockType}"]`).click()
  await expect(menu).toBeHidden()
}

/** Renames the block shown in the editor (double-click the header title). */
export async function renameSelected(page: Page, name: string) {
  const title = editor(page).locator('h2').first()
  await title.dblclick()
  const input = editor(page).locator('input[type="text"]').first()
  await input.fill(name)
  await input.press('Enter')
  await expect(editor(page).locator('h2').first()).toHaveText(name)
}

/** Reveals advanced fields of the selected block when `id` is hidden behind them. */
export async function revealSubBlock(page: Page, id: string): Promise<Locator> {
  const sb = subBlock(page, id)
  if (!(await sb.isVisible())) {
    const toggle = editor(page).getByRole('button', { name: 'Show additional fields' })
    if (await toggle.isVisible()) await toggle.click()
  }
  await expect(sb).toBeVisible()
  return sb
}

/** Connects `from[fromHandle]` → `to[toHandle]` by dragging between the two handles. */
export async function connect(from: Locator, fromHandle: string, to: Locator, toHandle = 'target') {
  const page = from.page()
  const edges = page.locator('.react-flow__edge')
  const before = await edges.count()
  const src = from.locator(`.react-flow__handle[data-handleid="${fromHandle}"]`).first()
  const dst = to.locator(`.react-flow__handle[data-handleid="${toHandle}"]`).first()
  const a = await src.boundingBox()
  const b = await dst.boundingBox()
  if (!a || !b) throw new Error(`handle not visible: ${fromHandle} → ${toHandle}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(edges).toHaveCount(before + 1)
}
