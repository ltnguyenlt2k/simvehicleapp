import { expect, test } from '@playwright/test'
import { newUser, signUp } from '../lib/studio'

/** SV: Opening/reopening search must reset old state without erasing a newly entered query. */
test('search keeps the new query and resets it on reopen', async ({ page }) => {
  await signUp(page, newUser('search', 'Playwright search'))
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/)
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const palette = page.getByRole('dialog')
    const input = palette.getByRole('combobox')
    await expect(input).toHaveValue('')
    await input.fill('Create workflow')
    await expect(palette.getByRole('option', { name: 'Create workflow' })).toBeVisible()
    await expect(input).toHaveValue('Create workflow')
    await page.keyboard.press('Escape')
    await expect(palette).not.toBeVisible()
  }
})
