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
 * Regression found by the M15 full flow (assistant mocked at the BFF boundary, as in `m10-assistant`):
 * 1. a turn sent right after the editor loads carries the loaded workflow, so its proposal adds a block and keeps
 *    the existing one; before the fix the half-loaded canvas (no blocks) was sent and Accept deleted every block;
 * 2. a proposal made on another version of the workflow (here: an empty one) is refused, the canvas is untouched.
 */
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

const sse = (events: { event: string; data: unknown }[]) =>
  events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')

const LOG = {
  id: 'log1',
  type: 'sv_log',
  name: 'Log speed',
  props: { level: 'info', message: 'speed' },
  parentId: null,
}

async function mockAssistant(page: Page, sent: Graph[]) {
  await page.route('**/api/sv/ai/status', (route) =>
    route.fulfill({
      json: { configured: true, provider: 'scripted', model: 'e2e', externalServers: [] },
    })
  )
  await page.route(/\/api\/sv\/ai\/conversations\?workflowId=/, (route) =>
    route.fulfill({ json: { conversations: [] } })
  )
  await page.route('**/api/sv/ai/chat', (route) => {
    const body = route.request().postDataJSON() as { graph: Graph }
    sent.push(body.graph)
    // turn 1: the patch applied to the graph sent; turn 2: a proposal built on an empty workflow
    const base = sent.length === 1 ? body.graph : { ...body.graph, blocks: [], edges: [] }
    const graph: Graph = { ...base, blocks: [...base.blocks, LOG] }
    return route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        {
          event: 'proposal',
          data: {
            patch: { patchVersion: '1.0.0', ops: [] },
            graph,
            diagnostics: [],
            summary: {
              added: [{ id: LOG.id, type: LOG.type, name: LOG.name }],
              changed: [],
              removed: [],
              edgesAdded: 0,
            },
            valid: true,
          },
        },
        { event: 'done', data: { conversationId: 'c_reload', pending: false, steps: 1 } },
      ]),
    })
  })
}

test('assistant right after a reload: the proposal keeps the existing blocks; a stale one is refused', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const sent: Graph[] = []
  await mockAssistant(page, sent)
  await signUp(page, newUser('m15reload', 'Playwright Assistant Reload'))
  await setAutoConnect(page, false)
  await page.reload()
  await createWorkflow(page)
  await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 220, 260)
  await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

  await page.goto(new URL(page.url()).pathname)
  await page.locator('[data-tab-button="copilot"]').click()
  const panel = page.locator('[data-sv-assistant="panel"]')
  const input = panel.getByRole('textbox', { name: 'Message the assistant' })
  await expect(input).toBeEnabled({ timeout: 20_000 })
  await input.fill('Log the speed')
  await input.press('Enter')
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]!.blocks.map((b) => b.name)).toEqual(['When Speed changes 1'])

  const proposals = panel.locator('[data-sv-ai-proposal]')
  await expect(proposals).toHaveCount(1, { timeout: 30_000 })
  await proposals.first().locator('[data-sv-ai-preview]').click()
  await page.getByRole('button', { name: /^Accept/ }).click()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

  await input.fill('Log it again')
  await input.press('Enter')
  await expect(proposals).toHaveCount(2, { timeout: 30_000 })
  await proposals.nth(1).locator('[data-sv-ai-preview]').click()
  await expect(page.getByText(/made for another version of the workflow/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0)
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
})
