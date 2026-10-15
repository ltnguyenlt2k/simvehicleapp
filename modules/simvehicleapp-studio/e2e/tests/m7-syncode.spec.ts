import { expect, type Page, test } from '@playwright/test'
import {
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  editor,
  newUser,
  nodeByName,
  pane,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * M07-T17/T18/T19 in the browser with the orchestrator mocked at the BFF boundary (page routes): the
 * Projects page creates a project and assigns the workflow; SynCode shows stage progress, the
 * streamed build log and the Appendix A verification on success, and on failure the failing stage
 * with diagnostics that focus their block. The real pipeline is the M7 gate (docs/reports/M07.md).
 */

const PROJECT_ID = 'p_e2e'
const GENERATION_ID = 'g_e2e'

type Stage = 'ir' | 'codegen' | 'write' | 'deps' | 'build' | 'format-check' | 'test'
const STAGES: Stage[] = ['ir', 'codegen', 'write', 'deps', 'build', 'format-check', 'test']

function project(workflowIds: string[], status: 'creating' | 'ready' = 'ready') {
  return {
    id: PROJECT_ID,
    slug: 'hazard-app',
    name: 'Hazard App',
    appName: 'HazardApp',
    language: 'cpp',
    vssRelease: 'v4.0',
    settings: { mqttTopicPrefix: 'sv', traceLevel: 'trigger' },
    status,
    workflows: workflowIds.map((simWorkflowId) => ({ simWorkflowId, enabled: true })),
  }
}

function generation(
  state: 'queued' | 'running' | 'succeeded' | 'failed',
  extra: Record<string, unknown> = {}
) {
  const failedAt = extra.stage as Stage | undefined
  const stageState = (s: Stage) => {
    if (state === 'queued') return 'pending'
    if (state === 'running') return s === 'ir' ? 'passed' : s === 'codegen' ? 'running' : 'pending'
    if (state === 'succeeded') return s === 'deps' ? 'skipped' : 'passed'
    const at = STAGES.indexOf(failedAt ?? 'build')
    const i = STAGES.indexOf(s)
    return i < at ? 'passed' : i === at ? 'failed' : 'skipped'
  }
  const verdict = (s: Stage) => {
    const v = stageState(s)
    return v === 'running' ? 'pending' : v
  }
  return {
    id: GENERATION_ID,
    generationId: GENERATION_ID,
    projectId: PROJECT_ID,
    state,
    ...(state === 'succeeded' || state === 'failed' ? { success: state === 'succeeded' } : {}),
    stages: STAGES.map((name) => ({ name, state: stageState(name) })),
    verification: {
      ir: verdict('ir'),
      format: verdict('format-check'),
      compile: verdict('build'),
      tests: verdict('test'),
    },
    diagnostics: [],
    generatedFiles: [],
    workflows: [],
    createdAt: 1,
    ...extra,
  }
}

const sse = (lines: string[]) =>
  lines
    .map(
      (msg, seq) =>
        `id: ${seq}\nevent: log\ndata: ${JSON.stringify({ runId: GENERATION_ID, seq, ts: seq, stream: 'stdout', level: 'info', msg })}\n\n`
    )
    .join('')

/**
 * Mocks the project + generation BFF routes before the editor loads; the project is `creating` until
 * `workflow.id` is set (the editor polls it), then `ready` with that workflow. `final` is what the
 * generation ends as.
 */
async function mockSynCode(page: Page, workflow: { id: string }, final: Record<string, unknown>) {
  const sent: { open?: { workflowId: string } }[] = []
  let polls = 0
  await page.route(/\/api\/sv\/projects\?workspaceId=/, (route) =>
    route.fulfill({
      json: { projects: [workflow.id ? project([workflow.id]) : project([], 'creating')] },
    })
  )
  await page.route(`**/api/sv/projects/${PROJECT_ID}/generations`, (route) => {
    sent.push(route.request().postDataJSON())
    return route.fulfill({ status: 202, json: generation('queued') })
  })
  await page.route(`**/api/sv/projects/${PROJECT_ID}/generations/${GENERATION_ID}`, (route) =>
    route.fulfill({ json: polls++ === 0 ? generation('running') : final })
  )
  await page.route(
    `**/api/sv/projects/${PROJECT_ID}/generations/${GENERATION_ID}/events`,
    (route) =>
      route.fulfill({
        headers: { 'content-type': 'text/event-stream' },
        body: sse(['▶ ir', '1 workflow(s) compiled', '▶ build', '[100%] Built target app']),
      })
  )
  return sent
}

/** A workflow with one trigger block; returns the workflow id and the block id. */
async function workflowWithTrigger(page: Page, prefix: string) {
  await signUp(page, newUser(prefix, 'Playwright SynCode'))
  await setAutoConnect(page, false)
  await page.reload()
  const workflowId = await createWorkflow(page)
  await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 200, 200)
  const trigger = nodeByName(page, 'When Speed changes 1')
  await expect(trigger).toBeVisible()
  const blockId = await trigger.getAttribute('data-id')
  expect(blockId).toBeTruthy()
  return { workflowId, blockId: blockId as string }
}

test.describe('M7 SynCode', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('Projects page creates a project and assigns the workflow', async ({ page }) => {
    const { workflowId } = await workflowWithTrigger(page, 'm7p')
    const state = {
      projects: [] as ReturnType<typeof project>[],
      created: null as unknown,
      deleted: false,
    }
    await page.route(/\/api\/sv\/projects(\?|$)/, async (route) => {
      if (route.request().method() === 'POST') {
        state.created = route.request().postDataJSON()
        state.projects = [project([])]
        return route.fulfill({ json: state.projects[0] })
      }
      return route.fulfill({ json: { projects: state.projects } })
    })
    await page.route(`**/api/sv/projects/${PROJECT_ID}/workflows`, (route) => {
      const { workflowIds } = route.request().postDataJSON() as { workflowIds: string[] }
      state.projects = [project(workflowIds)]
      return route.fulfill({ json: state.projects[0] })
    })
    await page.route(`**/api/sv/projects/${PROJECT_ID}`, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      state.deleted = true
      state.projects = []
      return route.fulfill({ json: { deleted: true } })
    })
    await page.route(`**/api/sv/projects/${PROJECT_ID}/size`, (route) =>
      route.fulfill({ json: { bytes: 150 * 1024 ** 2, buildBytes: 140 * 1024 ** 2 } })
    )
    await page.route(/\/api\/sv\/capacity(\?|$)/, (route) =>
      route.fulfill({
        json: {
          disk: { freeBytes: 50 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, level: 'ok' },
          host: { apps: state.projects.length, limit: 100 },
          workspace: { apps: state.projects.length, limit: 10 },
          queue: { queued: 0, limit: 20 },
        },
      })
    )

    await page.getByRole('link', { name: 'Vehicle projects' }).click()
    const pageRoot = page.locator('[data-sv="projects-page"]')
    await expect(pageRoot).toContainText('No vehicle apps yet')
    await expect(pageRoot.locator('[data-sv="capacity-apps"]')).toHaveText(
      '0/10 apps in this workspace'
    )
    await page.getByRole('textbox', { name: 'Project name' }).fill('Hazard App')
    await expect(page.getByRole('textbox', { name: 'Project folder' })).toHaveValue('hazard-app')
    await page.locator('[data-sv="project-create-submit"]').click()
    const card = page.locator('[data-sv-project="hazard-app"]')
    await expect(card).toBeVisible()
    expect(state.created).toMatchObject({ name: 'Hazard App', slug: 'hazard-app', workflowIds: [] })
    await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready')

    const box = card.locator(`[data-sv-workflow="${workflowId}"]`)
    await box.click()
    await expect(box).toHaveAttribute('data-state', 'checked')
    expect(state.projects[0].workflows).toEqual([{ simWorkflowId: workflowId, enabled: true }])
    await expect(card).toContainText('150 MB')

    // ADR-0053: Delete asks for the app's name before removing it.
    await card.locator('[data-sv="project-actions"]').click()
    await page.locator('[data-sv="project-delete"]').click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', { name: 'Delete' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill('Hazard App')
    await confirm.click()
    await expect(card).toHaveCount(0)
    expect(state.deleted).toBe(true)
    await expect(pageRoot).toContainText('No vehicle apps yet')
  })

  test('SynCode on a workflow in no app creates the app, waits for it and starts by itself (M16-T05)', async ({
    page,
  }) => {
    const state = {
      projects: [] as ReturnType<typeof project>[],
      created: null as Record<string, unknown> | null,
      ready: false,
    }
    await page.route(/\/api\/sv\/projects(\?|$)/, (route) => {
      if (route.request().method() === 'POST') {
        state.created = route.request().postDataJSON()
        state.projects = [project(state.created?.workflowIds as string[], 'creating')]
        return route.fulfill({ json: state.projects[0] })
      }
      if (state.ready && state.projects[0]?.status === 'creating') {
        state.projects = [project(state.projects[0].workflows.map((w) => w.simWorkflowId))]
      }
      return route.fulfill({ json: { projects: state.projects } })
    })
    const sent: unknown[] = []
    await page.route(`**/api/sv/projects/${PROJECT_ID}/generations`, (route) => {
      sent.push(route.request().postDataJSON())
      return route.fulfill({ status: 202, json: generation('queued') })
    })
    await page.route(`**/api/sv/projects/${PROJECT_ID}/generations/${GENERATION_ID}`, (route) =>
      route.fulfill({ json: generation('succeeded') })
    )
    await page.route(
      `**/api/sv/projects/${PROJECT_ID}/generations/${GENERATION_ID}/events`,
      (route) =>
        route.fulfill({
          headers: { 'content-type': 'text/event-stream' },
          body: sse(['▶ ir', '[100%] Built target app']),
        })
    )
    const { workflowId } = await workflowWithTrigger(page, 'm7a')

    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 20_000 })
    await syncode.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-sv="create-app-release"]')).toHaveText(/^v\d+\.\d+/)
    await dialog.getByRole('textbox').fill('Hazard App')
    await dialog.getByRole('button', { name: 'Create and SynCode' }).click()
    await expect(dialog).toHaveCount(0)
    expect(state.created).toMatchObject({
      name: 'Hazard App',
      slug: 'hazard-app',
      workflowIds: [workflowId],
      language: 'cpp',
    })

    // The app is being prepared: the button says so and nothing is generated yet.
    await expect(syncode).toHaveText('Preparing app…')
    expect(sent).toHaveLength(0)
    state.ready = true
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1)
    await expect(page.locator('[data-sv="build-log"]')).toBeVisible()
  })

  test('SynCode pass: stages, build log, verification and the IDE link', async ({ page }) => {
    const workflow = { id: '' }
    const sent = await mockSynCode(
      page,
      workflow,
      generation('succeeded', {
        editor: { url: 'http://127.0.0.1:8080/?folder=/workspace/projects/hazard-app' },
      })
    )
    const { workflowId } = await workflowWithTrigger(page, 'm7s')
    workflow.id = workflowId
    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 20_000 })
    await syncode.click()

    const log = page.locator('[data-sv="build-log"]')
    await expect(log).toBeVisible()
    expect(sent[0].open?.workflowId).toBe(workflowId)
    await expect(log.getByRole('log', { name: 'Build log' })).toContainText(
      '[100%] Built target app'
    )
    for (const key of ['ir', 'format', 'compile', 'tests']) {
      await expect(log.locator(`[data-sv-verify="${key}"]`)).toHaveAttribute(
        'data-sv-state',
        'passed'
      )
    }
    await expect(log.locator('[data-sv-stage="deps"]')).toHaveAttribute('data-sv-state', 'skipped')
    await expect(log.locator('[data-sv="open-ide"]')).toHaveAttribute(
      'href',
      'http://127.0.0.1:8080/?folder=/workspace/projects/hazard-app'
    )
    await expect(syncode).toBeEnabled()
  })

  test('SynCode fail: failing stage and a diagnostic that focuses its block', async ({ page }) => {
    const workflow = { id: '' }
    // Serialized when the route answers: the ids are filled in once the workflow exists.
    const compileError = {
      code: 'CPP_COMPILE_ERROR',
      severity: 'error',
      stage: 'build',
      message: "'speed' was not declared in this scope",
      docs: 'diagnostics#CPP_COMPILE_ERROR',
      workflowId: '',
      blockId: '',
    }
    await mockSynCode(
      page,
      workflow,
      generation('failed', { stage: 'build', diagnostics: [compileError] })
    )
    const { workflowId, blockId } = await workflowWithTrigger(page, 'm7f')
    Object.assign(compileError, { workflowId, blockId })
    workflow.id = workflowId
    await dragFromToolbar(page, 'Stable for', 600, 200)
    await expect(nodeByName(page, 'Stable for 1')).toBeVisible()
    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 20_000 })
    await syncode.click()

    const log = page.locator('[data-sv="build-log"]')
    await expect(log.locator('[data-sv-stage="build"]')).toHaveAttribute('data-sv-state', 'failed')
    await expect(log.locator('[data-sv-verify="compile"]')).toHaveAttribute(
      'data-sv-state',
      'failed'
    )
    await expect(log.locator('[data-sv-verify="tests"]')).toHaveAttribute(
      'data-sv-state',
      'skipped'
    )
    await expect(log.locator('[data-sv="syncode-result"]')).toContainText('SynCode failed at Build')
    const problem = log.locator('[data-sv-diagnostic="CPP_COMPILE_ERROR"]')
    await expect(problem).toContainText("When Speed changes 1: 'speed' was not declared")

    await pane(page).click({ position: { x: 900, y: 600 } })
    await nodeByName(page, 'Stable for 1').click()
    await expect(editor(page).locator('h2').first()).toHaveText('Stable for 1')
    await problem.click()
    await expect(editor(page).locator('h2').first()).toHaveText('When Speed changes 1')
  })
})
