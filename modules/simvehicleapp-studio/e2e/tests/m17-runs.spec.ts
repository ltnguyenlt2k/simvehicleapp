import { expect, type Page, test } from '@playwright/test'
import {
  createWorkflow,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * M17-T05 in the browser with the orchestrator mocked at the BFF boundary (sandboxes on, ADR-0057): My runs lists
 * the app the user already runs in another workspace with Stop; Run then asks "Stop … and run" or "Run both", and
 * Run both starts this app beside it. A run in its last minutes shows Extend, which moves its limit. The real
 * stack is the M17 runtime gate (`gate/m17-runtime.sh`).
 */

const PROJECT_ID = 'p_lka'
const OTHER = 'p_acc'
const SPEED = 'Vehicle.Speed'
const limits = { sandbox: true, perUser: 2, total: 20, maxMinutes: 30, maxExtensions: 3 }

const project = (workflowId: string) => ({
  id: PROJECT_ID,
  slug: 'lka-app',
  name: 'LKA App',
  appName: 'LkaApp',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: workflowId ? 'ready' : 'creating',
  workflows: workflowId ? [{ simWorkflowId: workflowId, enabled: true }] : [],
})

const run = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
  id,
  projectId,
  generationId: 'g_1',
  state: 'running',
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  runningAt: 2,
  ...extra,
})

interface Mocks {
  workflowId: string
  mine: ReturnType<typeof run>[]
  started: number
  stopped: string[]
  extended: number
  own: ReturnType<typeof run> | null
}

async function mockRuns(page: Page, m: Mocks) {
  await page.route(/\/api\/sv\/projects\?workspaceId=/, (route) =>
    route.fulfill({ json: { projects: [project(m.workflowId)] } })
  )
  await page.route('**/api/sv/runs', (route) =>
    route.fulfill({
      json: {
        runs: m.mine.map((r) => ({
          ...r,
          projectName: r.projectId === OTHER ? 'ACC App' : 'LKA App',
          workspaceId: 'ws-other',
        })),
        limits,
      },
    })
  )
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs`, (route) => {
    if (route.request().method() === 'POST') {
      m.started++
      // In its last minutes already, so Extend shows (a real run gets 30 min).
      m.own = run('r_lka', PROJECT_ID, { expiresAt: Date.now() + 4 * 60_000, extensions: 0 })
      m.mine = [...m.mine, m.own]
      return route.fulfill({ status: 202, json: { ...m.own, state: 'starting' } })
    }
    return route.fulfill({ json: { runs: m.own ? [m.own] : [] } })
  })
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs/r_lka/events`, (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' })
  )
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs/r_lka/extend`, (route) => {
    m.extended++
    m.own = { ...m.own!, expiresAt: Date.now() + 34 * 60_000, extensions: 1 }
    m.mine = m.mine.map((r) => (r.id === 'r_lka' ? m.own! : r))
    return route.fulfill({ json: m.own })
  })
  await page.route(`**/api/sv/projects/${OTHER}/runs/r_acc/stop`, (route) => {
    m.stopped.push('r_acc')
    m.mine = m.mine.filter((r) => r.id !== 'r_acc')
    return route.fulfill({ json: run('r_acc', OTHER, { state: 'stopping' }) })
  })
}

test.describe('M17 My runs, Run beside another app, Extend', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('My runs ⇒ Run asks ⇒ Run both ⇒ Extend in the last minutes ⇒ Stop the other from My runs', async ({
    page,
  }) => {
    const m: Mocks = {
      workflowId: '',
      mine: [run('r_acc', OTHER, { expiresAt: Date.now() + 20 * 60_000 })],
      started: 0,
      stopped: [],
      extended: 0,
      own: null,
    }
    await mockRuns(page, m)
    await signUp(page, newUser('m17runs', 'Playwright Runs'))
    await setAutoConnect(page, false)
    await page.reload()
    m.workflowId = await createWorkflow(page)
    await dropSignal(page, SPEED, 'sv_on_signal_changed', 200, 200)
    await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

    // The app the user runs elsewhere is in My runs.
    const myRuns = page.locator('[data-sv="my-runs"]')
    await expect(myRuns).toHaveText(/My runs \(1\)/, { timeout: 20_000 })

    // Run asks: stop it, or run both (sandboxes, quota 2).
    const runButton = page.locator('[data-sv-action="run"]')
    await expect(runButton).toBeEnabled({ timeout: 20_000 })
    await runButton.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-sv="run-conflict"]')).toContainText(
      'ACC App is running. LKA App can run at the same time'
    )
    await expect(dialog.getByRole('button', { name: 'Stop ACC App and run' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Run both' }).click()
    await expect(dialog).toHaveCount(0)
    expect(m.started).toBe(1)
    expect(m.stopped).toEqual([])
    await expect(myRuns).toHaveText(/My runs \(2\)/, { timeout: 10_000 })

    // Its last minutes: Extend shows the time left and moves the limit.
    const extend = page.locator('[data-sv-action="extend"]')
    await expect(extend).toHaveText(/Extend \(4 min left\)/, { timeout: 10_000 })
    await extend.click()
    await expect.poll(() => m.extended).toBe(1)
    await expect(extend).toHaveCount(0, { timeout: 10_000 })

    // Stop the other app from My runs.
    await myRuns.click()
    const other = page.locator('[data-sv="my-run"][data-sv-run="r_acc"]')
    await expect(other).toContainText('ACC App')
    await expect(other).toContainText('stops in')
    await other.locator('[data-sv="my-run-stop"]').click()
    await expect.poll(() => m.stopped).toEqual(['r_acc'])
    await expect(myRuns).toHaveText(/My runs \(1\)/, { timeout: 10_000 })
  })
})
