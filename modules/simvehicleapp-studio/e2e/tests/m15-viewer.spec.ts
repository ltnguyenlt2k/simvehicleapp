import { expect, test } from '@playwright/test'
import {
  createWorkflow,
  dragFromToolbar,
  newUser,
  nodeByName,
  pane,
  setAutoConnect,
  signUp,
} from '../lib/studio'

/**
 * M15-T02 (SCENARIOS B4): a workspace member with read permission sees the workflow but cannot add a block —
 * dropping from the toolbar creates nothing, for them or for the owner (ADR-0032 §3: owner/editor/viewer).
 */
test('a viewer cannot drop blocks on a workflow they can only read', async ({ page, browser }) => {
  test.setTimeout(240_000)
  await signUp(page, newUser('m15owner', 'Playwright Owner'))
  await setAutoConnect(page, false)
  await page.reload()
  await createWorkflow(page)
  await dragFromToolbar(page, 'Wait', 300, 200)
  await expect(nodeByName(page, 'Wait 1')).toBeVisible()
  const url = page.url()
  const workspaceId = new URL(url).pathname.split('/')[2]

  const viewer = newUser('m15viewer', 'Playwright Viewer')
  const invited = await page.request.post('/api/workspaces/invitations/batch', {
    data: { workspaceId, invitations: [{ email: viewer.email, permission: 'read' }] },
  })
  const body = (await invited.json()) as { invitations?: { id: string }[]; failed?: unknown[] }
  expect(invited.ok(), JSON.stringify(body)).toBe(true)
  const invitationId = body.invitations?.[0]?.id
  expect(invitationId, JSON.stringify(body)).toBeTruthy()

  const v = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  await signUp(v, viewer)
  const accepted = await v.request.post(`/api/invitations/${invitationId}/accept`, { data: {} })
  expect(accepted.ok(), await accepted.text()).toBe(true)

  await v.goto(url)
  await expect(nodeByName(v, 'Wait 1')).toBeVisible({ timeout: 30_000 })
  await v.locator('[data-tab-button="toolbar"]').click()
  const item = v
    .locator('[data-tab-content="toolbar"]')
    .getByRole('button', { name: 'Add Log', exact: true })
    .first()
  await expect(item).toBeVisible()
  await item.dragTo(pane(v), { targetPosition: { x: 700, y: 300 }, force: true })
  await v.waitForTimeout(2000)
  await expect(v.locator('.react-flow__node')).toHaveCount(1)
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.reload()
  await expect(nodeByName(page, 'Wait 1')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await v.context().close()
})
