/** What a tool call of the assistant does, in words a user reads while it runs (M17-T06). */
const TOOL_LABELS: Record<string, string> = {
  vss_search: 'Searching vehicle signals',
  vss_get_signal: 'Looking up a vehicle signal',
  blocks_list: 'Reading the available blocks',
  workflow_get: 'Reading the workflow',
  workflow_propose_patch: 'Preparing a change to the workflow',
  workflow_validate: 'Checking the workflow',
  workflow_simulate: 'Simulating the workflow',
  diagnostics_explain: 'Explaining a problem',
  run_logs: 'Reading the app log',
  project_syncode: 'Building the vehicle app (SynCode)',
  run_start: 'Starting the vehicle app',
  run_stop: 'Stopping the vehicle app',
  signal_set: 'Setting a vehicle signal',
}

/** The label of a tool; a tool this list does not know shows its name. */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** After this long without the turn ending, the panel says the model is slow. */
export const SLOW_TURN_MS = 30_000

/** "12 s", "1 min 05 s": how long the turn has been running. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

export type ToolStepState = 'running' | 'done' | 'failed' | 'stopped'

/** A tool call is running until its result comes; a turn that ended without one was stopped. */
export function toolStepState(
  tool: { done?: boolean; isError?: boolean },
  streaming: boolean
): ToolStepState {
  if (tool.isError) return 'failed'
  if (tool.done) return 'done'
  return streaming ? 'running' : 'stopped'
}
