import type { Metadata } from 'next'
import { SystemStatus } from '@/app/workspace/[workspaceId]/system-status/system-status'

export const metadata: Metadata = {
  title: 'System status',
}

/** Health and version of every SimVehicleApp service (M11-T05, ADR-0033 §4). */
export default function SystemStatusPage() {
  return <SystemStatus />
}
