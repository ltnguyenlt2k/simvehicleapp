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
 * M10-T08 in the browser with the ai-assistant mocked at the BFF boundary (a scripted LLM, no
 * provider): a turn streams text and tool calls, its proposal is shown on the canvas as a diff and
 * accepted there (saved with the workflow); a sensitive action waits for a confirmation whose
 * edited input is what the assistant receives. The real assistant is the M10 gate
 * (`modules/simvehicleapp-ai/eval/gate.ts`).
 */

const PROJECT_ID = 'p_ai'
const SPEED = 'Vehicle.Speed'

const project = (workflowId: string) => ({
  id: PROJECT_ID,
  slug: 'ai-app',
  name: 'AI App',
  appName: 'AiApp',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: workflowId ? 'ready' : 'creating',
  workflows: workflowId ? [{ simWorkflowId: workflowId, enabled: true }] : [],
})

const sse = (events: { event: string; data: unknown }[]) =>
  events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')

interface Graph {
  workflowId: string
  blocks: {
    id: string
    type: string
    name: string
    props: Record<string, unknown>
    parentId: string | null
  }[]
  edges: { id: string; from: string; fromHandle: string; to: string; toHandle: string }[]
}

interface Mocks {
  workflowId: string
  chats: { message: string; projectId?: string; graph: Graph }[]
  confirmed: unknown[]
}

async function mockAssistant(page: Page, m: Mocks) {
  await page.route(/\/api\/sv\/projects\?workspaceId=/, (route) =>
    route.fulfill({ json: { projects: [project(m.workflowId)] } })
  )
  await page.route('**/api/sv/ai/status', (route) =>
    route.fulfill({
      json: { configured: true, provider: 'scripted', model: 'e2e', externalServers: [] },
    })
  )
  await page.route(/\/api\/sv\/ai\/conversations\?workflowId=/, (route) =>
    route.fulfill({ json: { conversations: [] } })
  )
  await page.route('**/api/sv/ai/chat', (route) => {
    const body = route.request().postDataJSON() as Mocks['chats'][number]
    m.chats.push(body)
    const trigger = body.graph.blocks.find((b) => b.type === 'sv_on_signal_changed')
    if (m.chats.length === 1 && trigger) {
      // Turn 1: a log after the trigger — the proposal is the whole graph after the patch.
      const graph: Graph = {
        ...body.graph,
        blocks: [
          ...body.graph.blocks,
          {
            id: 'log1',
            type: 'sv_log',
            name: 'Log speed',
            props: { level: 'info', message: 'speed changed' },
            parentId: null,
          },
        ],
        edges: [
          ...body.graph.edges,
          { id: 'e_new', from: trigger.id, fromHandle: 'source', to: 'log1', toHandle: 'target' },
        ],
      }
      return route.fulfill({
        headers: { 'content-type': 'text/event-stream' },
        body: sse([
          { event: 'text', data: { delta: 'Adding a log after the trigger.' } },
          { event: 'tool', data: { id: 't1', name: 'workflow_propose_patch', input: {} } },
          {
            event: 'tool_result',
            data: { id: 't1', name: 'workflow_propose_patch', isError: false, text: 'valid' },
          },
          {
            event: 'proposal',
            data: {
              patch: { patchVersion: '1.0.0', ops: [] },
              graph,
              diagnostics: [],
              summary: {
                added: [{ id: 'log1', type: 'sv_log', name: 'Log speed' }],
                changed: [],
                removed: [],
                edgesAdded: 1,
              },
              valid: true,
            },
          },
          { event: 'done', data: { conversationId: 'c_e2e', pending: false, steps: 2 } },
        ]),
      })
    }
    // Turn 2: run the app — a sensitive tool, so the turn ends waiting for a confirmation.
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        { event: 'tool', data: { id: 't2', name: 'run_start', input: { projectId: PROJECT_ID } } },
        {
          event: 'pending_action',
          data: {
            actionId: 'a1',
            toolName: 'run_start',
            toolInput: { projectId: PROJECT_ID },
            description: 'Run the app on the stack',
            expiresAt: Date.now() + 60_000,
          },
        },
        { event: 'done', data: { conversationId: 'c_e2e', pending: true, steps: 1 } },
      ]),
    })
  })
  await page.route('**/api/sv/ai/conversations/c_e2e/actions/a1/confirm', (route) => {
    m.confirmed.push(route.request().postDataJSON())
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        {
          event: 'tool_result',
          data: { id: 't2', name: 'run_start', isError: false, text: 'started' },
        },
        { event: 'text', data: { delta: 'The app is running.' } },
        { event: 'done', data: { conversationId: 'c_e2e', pending: false, steps: 2 } },
      ]),
    })
  })
}

test.describe('M10 Assistant panel', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('turn ⇒ proposal on the canvas ⇒ Accept (saved); sensitive action ⇒ edited input confirmed', async ({
    page,
  }) => {
    const m: Mocks = { workflowId: '', chats: [], confirmed: [] }
    await mockAssistant(page, m)
    await signUp(page, newUser('m10', 'Playwright Assistant'))
    await setAutoConnect(page, false)
    await page.reload()
    m.workflowId = await createWorkflow(page)
    await dropSignal(page, SPEED, 'sv_on_signal_changed', 200, 200)
    await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

    // The project (polled while `creating`) now holds the workflow: turns carry it.
    await expect(page.locator('[data-sv-action="export"]')).toBeEnabled({ timeout: 20_000 })
    await page.locator('[data-tab-button="copilot"]').click()
    const panel = page.locator('[data-sv-assistant="panel"]')
    await expect(panel).toContainText('scripted · e2e')
    const input = panel.getByRole('textbox', { name: 'Message the assistant' })
    await expect(input).toBeEnabled({ timeout: 20_000 })
    await input.fill('Log when the speed changes')
    await input.press('Enter')

    await expect(panel.locator('[data-sv-ai-message="user"]')).toHaveText(
      'Log when the speed changes'
    )
    await expect(panel.locator('[data-sv-ai-message="assistant"]')).toContainText(
      'Adding a log after the trigger.'
    )
    await expect(panel.locator('[data-sv-ai-tool="workflow_propose_patch"]')).toBeVisible()
    expect(m.chats[0]).toMatchObject({ projectId: PROJECT_ID, graph: { workflowId: m.workflowId } })

    const card = panel.locator('[data-sv-ai-proposal]')
    await expect(card).toContainText('+ Log speed')
    // Shown on the canvas as a diff (saved like Sim's diff view does), then accepted there.
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' && /\/api\/workflows\/[^/]+\/state/.test(r.url()) && r.ok()
    )
    await card.locator('[data-sv-ai-preview]').click()
    await expect(card).toHaveAttribute('data-sv-ai-proposal', 'previewed')
    await expect(nodeByName(page, 'Log speed')).toBeVisible()
    await saved
    await page.getByRole('button', { name: /^Accept/ }).click()
    await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
    await page.reload()
    await expect(nodeByName(page, 'Log speed')).toBeVisible({ timeout: 20_000 })
    await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

    // A second turn in the same conversation asks to run: confirm with an edited input.
    await page.locator('[data-tab-button="copilot"]').click()
    await panel.getByRole('textbox', { name: 'Message the assistant' }).fill('Run it')
    await panel.locator('[data-sv-assistant="send"]').click()
    const action = panel.locator('[data-sv-ai-action="run_start"]')
    await expect(action).toHaveAttribute('data-sv-ai-action-state', 'pending')
    await action
      .getByRole('textbox', { name: 'Input of run_start' })
      .fill('{ "projectId": "p_ai", "note": "edited" }')
    await action.locator('[data-sv-ai-confirm]').click()
    await expect(action).toHaveAttribute('data-sv-ai-action-state', 'confirmed')
    await expect(panel).toContainText('The app is running.')
    expect(m.confirmed).toEqual([
      expect.objectContaining({
        workflowId: m.workflowId,
        editedInput: { projectId: 'p_ai', note: 'edited' },
      }),
    ])
  })
})
