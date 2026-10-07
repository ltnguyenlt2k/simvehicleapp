import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { type Browser, expect, type Page, test } from '@playwright/test'
import {
  createWorkflow,
  dragFromToolbar,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * M15-T07 (SCENARIOS A5/A6). Three sessions on one workflow add blocks at the same time and edit the same field:
 * every session converges to the same canvas, and a reload shows it. `@live` outage (host only, it stops a
 * container): with the compiler down the Problems panel says so, edits are still saved, and lint recovers by itself
 * (no edit needed) once the compiler is back.
 */
const REPO = process.env.SV_REPO ?? fileURLToPath(new URL('../../../..', import.meta.url))

async function session(
  browser: Browser,
  storageState: Awaited<ReturnType<Page['context']>['storageState']>,
  url: string
) {
  const page = await (
    await browser.newContext({ storageState, viewport: { width: 1600, height: 1000 } })
  ).newPage()
  await page.goto(url)
  await expect(page.locator('.react-flow__renderer')).toBeVisible()
  return page
}

test.describe('M15 collaboration and outages', () => {
  test.use({ viewport: { width: 1600, height: 1000 } })

  test('three sessions add and edit at once, every session converges', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000)
    await signUp(page, newUser('m15collab', 'Playwright Collab'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)
    const url = page.url()
    const state = await page.context().storageState()
    const b = await session(browser, state, url)
    const c = await session(browser, state, url)
    const all = [page, b, c]

    await Promise.all([
      dragFromToolbar(page, 'Wait', 200, 200),
      dragFromToolbar(b, 'Log', 600, 200),
      dragFromToolbar(c, 'Stop', 1000, 200),
    ])
    for (const p of all) {
      await expect(p.locator('.react-flow__node')).toHaveCount(3, { timeout: 30_000 })
    }
    for (const p of all) {
      for (const name of ['Wait 1', 'Log 1', 'Stop 1'])
        await expect(nodeByName(p, name)).toBeVisible()
    }

    // the same field edited in two sessions: both end with one value
    for (const [p, text] of [
      [page, 'from session A'],
      [b, 'from session B'],
    ] as const) {
      await nodeByName(p, 'Log 1').click({ position: { x: 24, y: 16 } })
      const message = subBlock(p, 'message').locator('textarea').first()
      await message.fill(text)
      await message.press('Escape')
    }
    const valueIn = (p: Page) => subBlock(p, 'message').locator('textarea').first().inputValue()
    await expect
      .poll(async () => (await valueIn(page)) === (await valueIn(b)), { timeout: 30_000 })
      .toBe(true)
    expect(['from session A', 'from session B']).toContain(await valueIn(page))

    await c.reload()
    await expect(c.locator('.react-flow__node')).toHaveCount(3, { timeout: 30_000 })
    await nodeByName(c, 'Log 1').click({ position: { x: 24, y: 16 } })
    await expect(subBlock(c, 'message').locator('textarea').first()).toHaveValue(
      await valueIn(page)
    )
    for (const p of [b, c]) await p.context().close()
  })

  test('@live compiler outage: Problems says so, edits are saved, lint recovers', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const compose = (...args: string[]) =>
      execFileSync('docker', ['compose', ...args], { cwd: REPO, stdio: 'pipe' })
    await signUp(page, newUser('m15outage', 'Playwright Outage'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)
    await dragFromToolbar(page, 'Log', 300, 200)
    await nodeByName(page, 'Log 1').click({ position: { x: 24, y: 16 } })
    const message = subBlock(page, 'message').locator('textarea').first()
    await page.locator('[data-sv-tab="problems"]').click()
    const summary = page.locator('[data-sv="problems"] > p').first()
    try {
      compose('stop', 'compiler')
      await message.fill('written while the compiler is down')
      await message.press('Escape')
      await expect(summary).toHaveText('Checks unavailable — showing the last result', {
        timeout: 60_000,
      })
      await page.reload()
      await nodeByName(page, 'Log 1').click({ position: { x: 24, y: 16 } })
      await expect(subBlock(page, 'message').locator('textarea').first()).toHaveValue(
        'written while the compiler is down'
      )
    } finally {
      compose('start', 'compiler')
    }
    compose('up', '-d', '--wait', 'compiler')
    // no edit: the panel lints the same graph again until the compiler answers (studio SV_LINT_RECOVERY_MS)
    await page.locator('[data-sv-tab="problems"]').click()
    await expect(summary).not.toHaveText('Checks unavailable — showing the last result', {
      timeout: 60_000,
    })
    await expect(summary).toHaveText(/^(No problems|\d+ error)/)
  })
})
