import { requestJson } from '@/lib/api/client/request'
import {
  type SvScenario,
  svGetScenarioContract,
  svGetWorkflowSettingsContract,
  svScenarioSchema,
  svUpdateScenarioContract,
  svUpdateWorkflowSettingsContract,
  svVssReleaseSchema,
} from '@/lib/api/contracts/sv'

/**
 * The vehicle data of a workflow that lives beside Sim's workflow state (ADR-0056, M17-T03): its pinned VSS release
 * (`sv_workflow_settings`) and its scenario (`sv_workflow_scenarios`). A downloaded `.json` carries it under the
 * top-level key `simvehicleapp`, so moving a workflow keeps its release and its test.
 */
export interface SvWorkflowSidecar {
  vssRelease?: string
  scenario?: SvScenario
}

/**
 * The workflow's release and scenario; what cannot be read is left out (the export still works). Always an object,
 * empty for a workflow on the default release without scenario, so an import tells a SimVehicleApp download (key
 * present) from a file exported before M17 (key absent).
 */
export async function fetchSvSidecar(workflowId: string): Promise<SvWorkflowSidecar> {
  const [settings, scenario] = await Promise.all([
    requestJson(svGetWorkflowSettingsContract, { params: { id: workflowId } }).catch(() => null),
    requestJson(svGetScenarioContract, { params: { id: workflowId } }).catch(() => null),
  ])
  const sidecar: SvWorkflowSidecar = {}
  if (settings?.vssRelease) sidecar.vssRelease = settings.vssRelease
  if (scenario?.scenario) sidecar.scenario = scenario.scenario
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
  const { vssRelease, scenario } = raw as { vssRelease?: unknown; scenario?: unknown }
  const sidecar: SvWorkflowSidecar = {}
  const release = svVssReleaseSchema.safeParse(vssRelease)
  if (release.success) sidecar.vssRelease = release.data
  const sc = svScenarioSchema.safeParse(scenario)
  if (sc.success) sidecar.scenario = sc.data
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
  if (sidecar.scenario) {
    await requestJson(svUpdateScenarioContract, {
      params: { id: workflowId },
      body: { scenario: sidecar.scenario },
    }).catch(() => failed.push('scenario'))
  }
  return failed
}
