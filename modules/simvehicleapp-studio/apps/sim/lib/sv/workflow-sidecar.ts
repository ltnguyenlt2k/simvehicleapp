import { requestJson } from '@/lib/api/client/request'
import {
  type SvScenario,
  svCreateTestCaseContract,
  svGetScenarioContract,
  svGetWorkflowSettingsContract,
  svListTestCasesContract,
  svScenarioSchema,
  svUpdateScenarioContract,
  svUpdateWorkflowSettingsContract,
  svVssReleaseSchema,
} from '@/lib/api/contracts/sv'

/**
 * The vehicle data of a workflow that lives beside Sim's workflow state (ADR-0056, M17-T03): its pinned VSS release
 * (`sv_workflow_settings`) and its test cases (ADR-0058). A downloaded `.json` carries it under the top-level key
 * `simvehicleapp`, so moving a workflow keeps its release and its tests. `scenario` (the first case) stays for files
 * read by a studio from before test cases.
 */
export interface SvWorkflowSidecar {
  vssRelease?: string
  scenario?: SvScenario
  testCases?: { name: string; scenario: SvScenario }[]
}

/**
 * The workflow's release and scenario; what cannot be read is left out (the export still works). Always an object,
 * empty for a workflow on the default release without scenario, so an import tells a SimVehicleApp download (key
 * present) from a file exported before M17 (key absent).
 */
export async function fetchSvSidecar(workflowId: string): Promise<SvWorkflowSidecar> {
  const [settings, scenario, cases] = await Promise.all([
    requestJson(svGetWorkflowSettingsContract, { params: { id: workflowId } }).catch(() => null),
    requestJson(svGetScenarioContract, { params: { id: workflowId } }).catch(() => null),
    requestJson(svListTestCasesContract, { params: { id: workflowId } }).catch(() => null),
  ])
  const sidecar: SvWorkflowSidecar = {}
  if (settings?.vssRelease) sidecar.vssRelease = settings.vssRelease
  if (scenario?.scenario) sidecar.scenario = scenario.scenario
  if (cases?.cases.length) {
    sidecar.testCases = cases.cases.map((c) => ({ name: c.name, scenario: c.scenario }))
  }
  return sidecar
}

/**
 * The `simvehicleapp` part of a downloaded workflow, checked against the contracts; invalid parts are dropped.
 * `undefined` when the file has no such key.
 */
export function readSvSidecar(parsed: unknown): SvWorkflowSidecar | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const raw = (parsed as { simvehicleapp?: unknown }).simvehicleapp
  if (!raw || typeof raw !== 'object') return undefined
  const { vssRelease, scenario, testCases } = raw as {
    vssRelease?: unknown
    scenario?: unknown
    testCases?: unknown
  }
  const sidecar: SvWorkflowSidecar = {}
  const release = svVssReleaseSchema.safeParse(vssRelease)
  if (release.success) sidecar.vssRelease = release.data
  const sc = svScenarioSchema.safeParse(scenario)
  if (sc.success) sidecar.scenario = sc.data
  if (Array.isArray(testCases)) {
    const valid = testCases.flatMap((c) => {
      const name = (c as { name?: unknown })?.name
      const parsed = svScenarioSchema.safeParse((c as { scenario?: unknown })?.scenario)
      return typeof name === 'string' && name.trim() && name.length <= 80 && parsed.success
        ? [{ name: name.trim(), scenario: parsed.data }]
        : []
    })
    if (valid.length) sidecar.testCases = valid
  }
  return sidecar
}

/** Writes the release and the scenario of an imported workflow; returns what could not be restored. */
export async function restoreSvSidecar(
  workflowId: string,
  sidecar: SvWorkflowSidecar
): Promise<string[]> {
  const failed: string[] = []
  if (sidecar.vssRelease) {
    await requestJson(svUpdateWorkflowSettingsContract, {
      params: { id: workflowId },
      body: { vssRelease: sidecar.vssRelease },
    }).catch(() => failed.push(`VSS release ${sidecar.vssRelease}`))
  }
  if (sidecar.testCases?.length) {
    for (const c of sidecar.testCases) {
      await requestJson(svCreateTestCaseContract, {
        params: { id: workflowId },
        body: { name: c.name, scenario: c.scenario },
      }).catch(() => failed.push(`test case ${c.name}`))
    }
  } else if (sidecar.scenario) {
    await requestJson(svUpdateScenarioContract, {
      params: { id: workflowId },
      body: { scenario: sidecar.scenario },
    }).catch(() => failed.push('scenario'))
  }
  return failed
}
