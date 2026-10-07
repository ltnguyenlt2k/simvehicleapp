import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import {
  connect,
  createWorkflow,
  dropSignal,
  newUser,
  nodeByName,
  setAutoConnect,
  signUp,
  subBlock,
} from '../lib/studio'

/**
 * @live — needs the full dev stack (`scripts/sv up`, including `ide-cpp`), skipped in CI like the
 * other live specs.
 *
 * M9 through the UI: "When Speed changes → Set Hazard" ⇒ project + SynCode ⇒ Export downloads a zip
 * with the generating workflow ⇒ Open IDE opens code-server on the project folder, where the generated
 * sources are in the explorer and open in an editor (M09-T04/T06).
 */

const SPEED = 'Vehicle.Speed'
const HAZARD = 'Vehicle.Body.Lights.Hazard.IsSignaling'

test.describe('M9 IDE and export on the real stack', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('@live SynCode ⇒ Export zip ⇒ Open IDE shows the generated files', async ({ page }) => {
    test.setTimeout(600_000)
    await signUp(page, newUser('m9live', 'Playwright Live IDE'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    const editorUrl = new URL(page.url()).pathname

    await dropSignal(page, SPEED, 'sv_on_signal_changed', 200, 200)
    const trigger = nodeByName(page, 'When Speed changes 1')
    await expect(trigger).toBeVisible()
    await dropSignal(page, HAZARD, 'sv_set_actuator', 700, 200)
    const set = nodeByName(page, 'Set IsSignaling 1')
    await expect(set).toBeVisible()
    await set.click()
    const value = subBlock(page, 'value').locator('textarea').first()
    await value.fill('<whenspeedchanges1.value> > 120')
    await value.press('Escape')
    await connect(trigger, 'source', set)

    await page.getByRole('link', { name: 'Vehicle projects' }).click()
    await page.getByRole('textbox', { name: 'Project name' }).fill(`IDE ${workflowId.slice(0, 8)}`)
    const slug = await page.getByRole('textbox', { name: 'Project folder' }).inputValue()
    await page.locator('[data-sv="project-create-submit"]').click()
    const card = page.locator(`[data-sv-project="${slug}"]`)
    await expect(card.locator('[data-sv="project-status"]')).toHaveText('Ready', {
      timeout: 180_000,
    })
    await card.locator(`[data-sv-workflow="${workflowId}"]`).click()
    await page.goto(editorUrl)
    const syncode = page.locator('[data-sv-action="syncode"]')
    await expect(syncode).toBeEnabled({ timeout: 30_000 })
    await syncode.click()
    await expect(page.locator('[data-sv="build-log"] [data-sv="syncode-result"]')).toContainText(
      'SynCode passed',
      { timeout: 240_000 }
    )

    // Export: a zip attachment whose (uncompressed) central directory names the workflow graph.
    const exportButton = page.locator('[data-sv-action="export"]')
    await expect(exportButton).toBeEnabled()
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()])
    expect(download.suggestedFilename()).toBe(`${slug}.zip`)
    const zip = readFileSync(await download.path()).toString('latin1')
    expect(zip.startsWith('PK')).toBe(true)
    for (const name of [
      '.simvehicleapp/workflows/',
      '.simvehicleapp/generation.json',
      'README.SIMVEHICLE.md',
      'THIRD-PARTY-NOTICES',
      'app/src/generated/SimVehicleApp.cpp',
    ])
      expect(zip).toContain(name)

    // Open IDE: code-server on the project folder (password login), generated sources in the explorer.
    const openIde = page.locator('[data-sv-action="open-ide"]')
    await expect(openIde).toBeEnabled()
    const [ide] = await Promise.all([page.waitForEvent('popup'), openIde.click()])
    await ide.waitForLoadState()
    const password = ide.locator('input[name="password"]')
    if (await password.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await password.fill(process.env.SV_IDE_PASSWORD ?? 'simvehicleapp')
      await password.press('Enter')
    }
    expect(decodeURIComponent(ide.url())).toContain(`folder=/workspace/projects/${slug}`)
    const explorer = ide.locator('.explorer-folders-view')
    for (const folder of ['app', 'src', 'generated']) {
      const item = explorer.getByRole('treeitem', { name: folder, exact: true })
      await expect(item).toBeVisible({ timeout: 120_000 })
      if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
    }
    const source = explorer.getByRole('treeitem', { name: 'SimVehicleApp.cpp', exact: true })
    await expect(source).toBeVisible()
    await source.dblclick()
    await expect(ide.locator('.monaco-editor .view-lines').first()).toContainText('SimVehicleApp', {
      timeout: 30_000,
    })
  })
})
