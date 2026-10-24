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
 * M18-T09 in the browser with the orchestrator mocked at the BFF boundary: Deploy opens a dialog, a deploy target is
 * added and tested, the app is deployed read-only; the status pill says where, and the Live tab watches the target's
 * signals with inject and Record disabled. The deployment itself is the backend gate `gate/m18-deploy.sh`.
 */

const PROJECT_ID = 'p_deploy'
const TARGET = {
  id: 'dt_1',
  workspaceId: '',
  name: 'HIL bench',
  address: 'bench.lab:55555',
  tls: false,
  vssRelease: 'v4.0',
  createdAt: 1,
  hasToken: false,
}

const project = (workflowId: string) => ({
  id: PROJECT_ID,
  slug: 'deploy-app',
  name: 'Deploy App',
  appName: 'DeployApp',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: 'ready',
  workflows: workflowId ? [{ simWorkflowId: workflowId, enabled: true }] : [],
})

interface Mocks {
  workflowId: string
  targets: (typeof TARGET)[]
  deployed: boolean
  bodies: unknown[]
}

async function mockDeploy(page: Page, m: Mocks) {
  await page.route(/\/api\/sv\/projects\?workspaceId=/, (route) =>
    route.fulfill({ json: { projects: [project(m.workflowId)] } })
  )
  await page.route(/\/api\/sv\/projects\/p_deploy\/runs$/, (route) =>
    route.fulfill({
      json: {
        runs: m.deployed
          ? [
              {
                id: 'r_dep',
                projectId: PROJECT_ID,
                generationId: 'g_1',
                state: 'running',
                vssRelease: 'v4.0',
                traceLevel: 'node',
                diagnostics: [],
                createdAt: 1,
                runningAt: 2,
                deploy: { targetId: 'dt_1', targetName: 'HIL bench', mode: 'read-only' },
              },
            ]
          : [],
      },
    })
  )
  await page.route(/\/api\/sv\/deploy-targets(\?|$)/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        workspaceId: string
        name: string
        address: string
      }
      m.bodies.push(body)
      const t = { ...TARGET, workspaceId: body.workspaceId, name: body.name, address: body.address }
      m.targets.push(t)
      return route.fulfill({ status: 201, json: t })
    }
    return route.fulfill({ json: { targets: m.targets } })
  })
  await page.route(/\/api\/sv\/deploy-targets\/dt_1\/test$/, (route) =>
    route.fulfill({
      json: {
        reachable: true,
        api: 'kuksa.val.v2',
        server: { name: 'databroker', version: '0.5.0' },
        missing: [],
      },
    })
  )
  await page.route(/\/api\/sv\/projects\/p_deploy\/deployments$/, (route) => {
    m.bodies.push(route.request().postDataJSON())
    m.deployed = true
    return route.fulfill({
      status: 202,
      json: {
        id: 'r_dep',
        projectId: PROJECT_ID,
        generationId: 'g_1',
        state: 'starting',
        vssRelease: 'v4.0',
        traceLevel: 'node',
        diagnostics: [],
        createdAt: 1,
        deploy: { targetId: 'dt_1', targetName: 'HIL bench', mode: 'read-only' },
      },
    })
  })
  // The followed deployment's events and signals: nothing to stream in this test.
  await page.route(/\/api\/sv\/projects\/p_deploy\/runs\/r_dep\/events/, (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' })
  )
  await page.route(/\/api\/sv\/projects\/p_deploy\/(signals|messages)/, (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' })
  )
}

test.describe('M18 Deploy', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('add a target, Test connection, deploy read-only ⇒ the pill and a Live tab that only watches', async ({
    page,
  }) => {
    const m: Mocks = { workflowId: '', targets: [], deployed: false, bodies: [] }
    await mockDeploy(page, m)
    await signUp(page, newUser('m18dep', 'Playwright Deploy'))
    await setAutoConnect(page, false)
    await page.reload()
    m.workflowId = await createWorkflow(page)
    await dropSignal(page, 'Vehicle.Speed', 'sv_on_signal_changed', 200, 200)
    await expect(nodeByName(page, 'When Speed changes 1')).toBeVisible()

    const deploy = page.locator('[data-sv-action="deploy"]')
    await expect(deploy).toBeEnabled({ timeout: 20_000 })
    await deploy.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Deploy Deploy App')
    await dialog.getByPlaceholder('HIL bench').fill('HIL bench')
    await dialog.getByPlaceholder('bench.lab:55555').fill('bench.lab:55555')
    await dialog.locator('[data-sv="deploy-test"]').click()
    await expect(dialog.locator('[data-sv="deploy-tested"]')).toContainText(
      'Reachable (databroker 0.5.0)'
    )
    await dialog.getByRole('button', { name: 'Deploy', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(m.bodies).toEqual([
      expect.objectContaining({
        name: 'HIL bench',
        address: 'bench.lab:55555',
        vssRelease: 'v4.0',
        tls: false,
      }),
      { targetId: 'dt_1', mode: 'read-only' },
    ])

    await expect(page.locator('[data-sv="status-pill"]')).toContainText(
      'Deployed · HIL bench · read-only',
      {
        timeout: 20_000,
      }
    )
    await expect(deploy).toContainText('Deployed')
    await page.locator('[data-sv-tab="live"]').click()
    await expect(page.locator('[data-sv="deployed-banner"]')).toContainText(
      'Deployed to HIL bench (read-only)'
    )
    await expect(page.locator('[data-sv="record"]')).toBeDisabled()
    await expect(page.locator('[data-sv-inject]').first()).toBeDisabled()
  })
})
