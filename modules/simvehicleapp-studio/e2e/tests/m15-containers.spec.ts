import { expect, type Page, test } from '@playwright/test'
import {
  createWorkflow,
  dragFromToolbar,
  newUser,
  nodeByName,
  pane,
  setAutoConnect,
  signUp,
  workflowIdOf,
} from '../lib/studio'

/**
 * M15-T02 (SCENARIOS B3): a block dropped into Loop / Parallel becomes its child (saved `parentId`), and
 * "Remove from Subflow" (block context menu) makes it top-level again — what the container mapping (`sv_repeat`,
 * `sv_while`, `sv_parallel`) reads.
 */
async function parentOf(page: Page, name: string): Promise<string | null> {
  const res = await page.request.get(`/api/workflows/${workflowIdOf(page)}`)
  expect(res.ok()).toBeTruthy()
  const blocks = (
    (await res.json()) as {
      data: { state: { blocks: Record<string, { name: string; data?: { parentId?: string } }> } }
    }
  ).data.state.blocks
  const block = Object.values(blocks).find((b) => b.name === name)
  expect(block, name).toBeTruthy()
  const parentId = block?.data?.parentId
  return parentId ? (blocks[parentId]?.name ?? parentId) : null
}

test.describe('M15 containers', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('into and out of Loop and Parallel', async ({ page }) => {
    test.setTimeout(180_000)
    await signUp(page, newUser('m15box', 'Playwright Containers'))
    await setAutoConnect(page, false)
    await page.reload()
    await createWorkflow(page)

    for (const [k, container] of ['Loop', 'Parallel'].entries()) {
      const y = 120 + k * 380
      await dragFromToolbar(page, container, 200, y)
      const box = await nodeByName(page, `${container} 1`).boundingBox()
      const area = await pane(page).boundingBox()
      if (!box || !area) throw new Error(`${container} not visible`)
      const child = `Wait ${k + 1}`
      await dragFromToolbar(page, 'Wait', box.x - area.x + 60, box.y - area.y + 90)
      await expect(nodeByName(page, child)).toBeVisible()
      await expect.poll(() => parentOf(page, child), { timeout: 15_000 }).toBe(`${container} 1`)

      // Sim takes a block out of a container through its context menu
      await nodeByName(page, child).click({ button: 'right', position: { x: 30, y: 14 } })
      await page.getByText('Remove from Subflow', { exact: true }).click()
      await expect.poll(() => parentOf(page, child), { timeout: 15_000 }).toBeNull()
    }
  })
})
