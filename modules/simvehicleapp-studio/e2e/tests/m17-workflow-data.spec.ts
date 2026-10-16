import { expect, type Page, test } from '@playwright/test'
import { createWorkflow, dropSignal, newUser, setAutoConnect, signUp } from '../lib/studio'

/**
 * M17-T03 (ADR-0056): a workflow's vehicle data — its pinned VSS release and its scenario — survives Duplicate,
 * "Download workflow (.json)" and importing that file back. Before M17 all three fell back to the default release
 * and lost the scenario (the generated test).
 */
const scenario = {
  scenarioVersion: '1.0.0',
  name: 'Overspeed check',
  until: 3000,
  inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 130 }],
}

async function vehicleData(page: Page, workflowId: string) {
  const settings = await (await page.request.get(`/api/sv/workflows/${workflowId}/settings`)).json()
  const saved = await (await page.request.get(`/api/sv/workflows/${workflowId}/scenario`)).json()
  return { vssRelease: settings.vssRelease, scenario: saved.scenario?.name ?? null }
}

test.describe('M17 workflow vehicle data kept', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('Duplicate, Download and Import keep the VSS release and the scenario', async ({ page }) => {
    await signUp(page, newUser('m17data', 'Playwright Data'))
    await setAutoConnect(page, false)
    await page.reload()
    const workflowId = await createWorkflow(page)
    const workspaceId = new URL(page.url()).pathname.split('/')[2]
    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 300, 260)

    expect(
      (
        await page.request.put(`/api/sv/workflows/${workflowId}/settings`, {
          data: { vssRelease: 'v4.2' },
        })
      ).ok()
    ).toBe(true)
    expect(
      (
        await page.request.put(`/api/sv/workflows/${workflowId}/scenario`, { data: { scenario } })
      ).ok()
    ).toBe(true)
    const expected = { vssRelease: 'v4.2', scenario: 'Overspeed check' }
    expect(await vehicleData(page, workflowId)).toEqual(expected)

    // Duplicate
    const dup = await page.request.post(`/api/workflows/${workflowId}/duplicate`, {
      data: { name: 'Overspeed copy', workspaceId },
    })
    expect(dup.status()).toBe(201)
    expect(await vehicleData(page, (await dup.json()).id)).toEqual(expected)

    // Download workflow (.json)
    await page.reload()
    await page.locator('[data-sv="workflow-menu"]').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download workflow (.json)' }).click(),
    ])
    const content = await (await download.createReadStream()).toArray()
    const file = Buffer.concat(content)
    const json = JSON.parse(file.toString('utf8'))
    expect(json.simvehicleapp.vssRelease).toBe('v4.2')
    expect(json.simvehicleapp.scenario.name).toBe('Overspeed check')

    // Import the downloaded file
    const before = page.url()
    await page
      .locator('input[type="file"][accept=".json,.zip"]')
      .setInputFiles({ name: 'overspeed.json', mimeType: 'application/json', buffer: file })
    await page.waitForURL((url) => url.href !== before && /\/w\/[^/]+$/.test(url.pathname), {
      timeout: 30_000,
    })
    const importedId = new URL(page.url()).pathname.split('/').pop() as string
    expect(importedId).not.toBe(workflowId)
    expect(await vehicleData(page, importedId)).toEqual(expected)
  })
})
