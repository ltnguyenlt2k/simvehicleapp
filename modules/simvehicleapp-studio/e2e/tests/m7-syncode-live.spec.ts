import { expect, type Page, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dragFromToolbar,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * @live — needs the full dev stack (`scripts/sv up`: orchestrator, workspace, codegen-cpp,
 * toolchain-cpp), so CI (studio + core only) skips it; run it locally with `--grep @live`.
 *
 * M07-T17…T19 for real: create a project on the Projects page, assign the workflow, SynCode builds
 * and tests the C++ app with the Velocitas toolchain; after a change, the second SynCode shows the
 * change as a diff against the previous generation in the generated-files viewer.
 */

async function setDuration(page: Page, ms: string) {
  await nodeByName(page, 'Stable for 1').click()
  const duration = subBlock(page, 'durationMs').getByRole('textbox', { name: 'Duration' })
  await duration.fill(ms)
  await duration.press('Tab')
}

async function synCode(page: Page) {
  const syncode = page.locator('[data-sv-action="syncode"]')
  await expect(syncode).toBeEnabled({ timeout: 30_000 })
  await syncode.click()
  const result = page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')
  await expect(result).toContainText('SynCode passed', { timeout: 240_000 })
  for (const key of ['ir', 'format', 'compile', 'tests']) {
    await expect(page.locator(`[data-sv-verify="${key}"]`)).toHaveAttribute(
      'data-sv-state',
      'passed'
    )
  }
}

test.describe('M7 SynCode on the real stack', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('@live project ⇒ SynCode ⇒ build + tests pass ⇒ generated files and diff', async ({
    page,
  }) => {
    test.setTimeout(600_000)
    await signUp(page, newUser('m7live', 'Playwright Live'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    const editorUrl = new URL(page.url()).pathname

    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 200, 200)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await expect(trigger).toBeVisible()
    await dragFromToolbar(page, 'Stable for', 600, 200)
    const stable = nodeByName(page, 'Stable for 1')
    await expect(stable).toBeVisible()
    await stable.click()
    const condition = subBlock(page, 'condition').locator('textarea').first()
    await condition.fill('<whenspeedchanges1.value> > 120')
    await condition.press('Escape')
    await setDuration(page, '2000')
    await dropSignal(page, 'Vehicle.Body.Lights.Hazard.IsSignaling', 'sv_set_actuator', 1000, 200)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await expect(set).toBeVisible()
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('true')
    await value.press('Escape')
    await connect(trigger, 'source', stable)
    await connect(stable, 'stable', set)

    // Projects page: create the project (prepared by the workspace + toolchain), assign the workflow.
    await page.getByRole('link', { name: 'Vehicle projects' }).click()
    const name = `Live ${workflowId.slice(0, 8)}`
    await page.getByRole('textbox', { name: 'Project name' }).fill(name)
    const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
    await page.locator('[data-sv="project-create-submit"]').click()
    const card = page.locator(`[data-sv-project="${slug}"]`)
    await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', {
      timeout: 180_000,
    })
    const box = card.locator(`[data-sv-workflow="${workflowId}"]`)
    await box.click()
    await expect(box).toHaveAttribute('data-state', 'checked')

    // SynCode with the real pipeline.
    await page.goto(editorUrl)
    await expect(page.locator('.react-flow__renderer')).toBeVisible()
    await synCode(page)
    await expect(page.locator('[data-sv="open-ide"]')).toHaveAttribute(
      'href',
      new RegExp(`/\\?folder=/workspace/projects/${slug}$`)
    )
    await expect(page.getByRole('log', { name: 'Build log' })).toContainText('[  PASSED  ]')

    // A change, a second SynCode, and the diff of the generated workflow code.
    await setDuration(page, '3000')
    await synCode(page)
    await page.getByRole('link', { name: 'Vehicle projects' }).click()
    await card.locator('[data-sv="project-files-toggle"]').click()
    const files = card.locator('[data-sv="generated-files"]')
    await files.locator('[data-sv-file^="app/src/generated/workflows/"]').first().click()
    await expect(files.locator('[data-sv="file-content"]')).toContainText('w.stableFor(')
    await files.locator('[data-sv="file-diff-toggle"]').click()
    await expect(
      files.locator('[data-sv-diff="del"]').filter({ hasText: '2000' }).first()
    ).toBeVisible()
    await expect(
      files.locator('[data-sv-diff="add"]').filter({ hasText: '3000' }).first()
    ).toBeVisible()
  })
})
