/**
 * SimVehicleApp editor chrome (M01-T10, analysis/05 §6). Actions and dock tabs are placeholders
 * until the milestone that implements them; the safety notice is NFR-10.
 */
export const SV_ACTIONS = [
  { id: 'verify', label: 'Verify', milestone: 'M4' },
  { id: 'simulate', label: 'Simulate', milestone: 'M5' },
  { id: 'syncode', label: 'SynCode', milestone: 'M7' },
  { id: 'run', label: 'Run', milestone: 'M8' },
  { id: 'stop', label: 'Stop', milestone: 'M8' },
  { id: 'open-ide', label: 'Open IDE', milestone: 'M9' },
  { id: 'export', label: 'Export', milestone: 'M9' },
] as const

export const SV_DOCK_TABS = [
  { id: 'problems', label: 'Problems', milestone: 'M3' },
  { id: 'simulation', label: 'Simulation timeline', milestone: 'M5' },
  { id: 'run-console', label: 'Run console', milestone: 'M8' },
  { id: 'signals', label: 'Signals', milestone: 'M8' },
  { id: 'build-log', label: 'Build log', milestone: 'M7' },
] as const

export type SvDockTabId = (typeof SV_DOCK_TABS)[number]['id']

export const SV_SAFETY_NOTICE =
  'High-level vehicle apps on KUKSA — not a replacement for safety-critical (ASIL) systems.'
