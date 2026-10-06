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
 * M08-T08/T09 in the browser with the orchestrator and signal-gateway mocked at the BFF boundary:
 * Run streams the app's log and trace into the Run console and the live block overlay; the Signals
 * panel shows current values, injects, records the injections as the workflow's scenario; Stop ends
 * the run. The real stack is the M8 gate (`gate/m8-gate.sh`, `m8-run-live.spec.ts`).
 */

const PROJECT_ID = 'p_run'
const RUN_ID = 'r_e2e'
const SPEED = 'Vehicle.Speed'

const project = (workflowId: string) => ({
  id: PROJECT_ID,
  slug: 'hazard-app',
  name: 'Hazard App',
  appName: 'HazardApp',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  // `creating` (polled by the editor) until the test's workflow exists, then ready with it.
  status: workflowId ? 'ready' : 'creating',
  workflows: workflowId ? [{ simWorkflowId: workflowId, enabled: true }] : [],
})

const run = (state: string) => ({
  id: RUN_ID,
  projectId: PROJECT_ID,
  generationId: 'g_1',
  state,
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  ...(state === 'running' ? { runningAt: 2 } : {}),
  ...(state === 'stopped' ? { finishedAt: 3 } : {}),
})

const sse = (events: { event: string; data: unknown }[]) =>
  events
    .map(
      (e, seq) =>
        `id: ${seq}\nevent: ${e.event}\ndata: ${JSON.stringify({ ...(e.data as object), seq })}\n\n`
    )
    .join('')

interface Mocks {
  workflowId: string
  blockId: string
  state: 'none' | 'running' | 'stopped'
  injected: unknown[]
  stopped: number
}

async function mockRuntime(page: Page, m: Mocks) {
  await page.route(/\/api\/sv\/projects\?workspaceId=/, (route) =>
    route.fulfill({ json: { projects: [project(m.workflowId)] } })
  )
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs`, (route) => {
    if (route.request().method() === 'POST') {
      m.state = 'running'
      return route.fulfill({ status: 202, json: run('starting') })
    }
    return route.fulfill({ json: { runs: m.state === 'none' ? [] : [run(m.state)] } })
  })
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs/${RUN_ID}/stop`, (route) => {
    m.stopped++
    m.state = 'stopped'
    return route.fulfill({ json: run('stopping') })
  })
  await page.route(`**/api/sv/projects/${PROJECT_ID}/runs/${RUN_ID}/events`, (route) => {
    const base = { runId: RUN_ID, ts: 1759200000000 }
    const node = { wf: m.workflowId, run: 1, node: 'n1', blockId: m.blockId }
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        {
          event: 'log',
          data: { ...base, stream: 'system', level: 'info', msg: '▶ run hazard-app' },
        },
        { event: 'trace', data: { ...base, ev: 'app.started' } },
        {
          event: 'log',
          data: { ...base, stream: 'stdout', level: 'info', msg: 'hello from the vehicle app' },
        },
        { event: 'trace', data: { ...base, ...node, ev: 'enter' } },
        { event: 'trace', data: { ...base, ...node, ev: 'exit' } },
        {
          event: 'log',
          data: { ...base, stream: 'stderr', level: 'error', msg: 'a warning-free error line' },
        },
      ]),
    })
  })
  await page.route(new RegExp(`/api/sv/projects/${PROJECT_ID}/signals`), (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { path: string; value: unknown; field: string }
      m.injected.push(body)
      return route.fulfill({ json: { ...body, ts: Date.now() } })
    }
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: `event: signal\ndata: ${JSON.stringify({ path: SPEED, ts: 1, value: 100, field: 'value' })}\n\n`,
    })
  })
}

test.describe('M8 Run, Run console, Signals', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('Run ⇒ log + trace in the console and on the block; Signals inject + record; Stop', async ({
    page,
  }) => {
    const m: Mocks = { workflowId: '', blockId: '', state: 'none', injected: [], stopped: 0 }
    await mockRuntime(page, m)
    await signUp(page, newUser('m8', 'Playwright Run'))
    await setAutoConnect(page, false)
    await page.reload()
    m.workflowId = await createWorkflow(page)
    await dropSignal(page, SPEED, 'sv_on_signal_changed', 200, 200)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await expect(trigger).toBeVisible()
    m.blockId = (await trigger.getAttribute('data-id')) as string

    // Run
    const runButton = page.locator('[data-sv-action="run"]')
    await expect(runButton).toBeEnabled({ timeout: 20_000 })
    await runButton.click()
    const runConsole = page.getByRole('log', { name: 'Run console' })
    await expect(runConsole).toContainText('hello from the vehicle app')
    await expect(runConsole).toContainText('n1 enter · When Speed changes 1')
    await expect(page.locator('[data-sv="run-state"]')).toHaveAttribute('data-sv-state', 'running')
    await expect(runButton).toBeDisabled()
    // live overlay on the block: entered and left once
    await expect(trigger.locator('[data-sv="trace-badge"]')).toHaveAttribute('data-sv-live', 'done')
    await expect(trigger.locator('[data-sv="trace-badge"]')).toHaveText('1×')
    // filters
    await page.getByRole('textbox', { name: 'Search the run log' }).fill('vehicle app')
    await expect(runConsole.locator('[data-sv-entry]')).toHaveCount(1)
    await page.getByRole('textbox', { name: 'Search the run log' }).fill('')

    // Signals: current value, inject, record ⇒ scenario
    await page.locator('[data-sv-tab="signals"]').click()
    const row = page.locator(`[data-sv-signal="${SPEED}"]`)
    await expect(row.locator('[data-sv-signal-value]')).toHaveText('100')
    await page.locator('[data-sv="record"]').click()
    await row.getByRole('textbox', { name: `Value for ${SPEED}` }).fill('130')
    await row.locator(`[data-sv-inject="${SPEED}"]`).click()
    await expect.poll(() => m.injected).toEqual([{ path: SPEED, value: 130, field: 'value' }])
    await expect(page.locator('[data-sv="recording"]')).toContainText('1 input')
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && r.url().includes('/scenario') && r.ok()
    )
    await page.locator('[data-sv="save-recording"]').click()
    const scenario = (await (await saved).request().postDataJSON()) as {
      scenario: { inputs: { path: string; value: unknown }[]; initial?: Record<string, unknown> }
    }
    expect(scenario.scenario.inputs).toMatchObject([{ path: SPEED, value: 130 }])
    expect(scenario.scenario.initial).toEqual({ [SPEED]: 100 })
    await expect(page.locator('[data-sv="scenario-editor"]')).toBeVisible()

    // Stop
    await page.locator('[data-sv-action="stop"]').click()
    await expect.poll(() => m.stopped).toBe(1)
    await expect(runButton).toBeEnabled({ timeout: 10_000 })
  })
})
