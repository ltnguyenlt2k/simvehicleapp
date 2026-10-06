import type { Metadata } from 'next'
import { VehicleProjects } from '@/app/workspace/[workspaceId]/vehicle-projects/vehicle-projects'

export const metadata: Metadata = {
  title: 'Vehicle projects',
}

/** Vehicle-app projects of the workspace (M07-T17): SynCode generates the C++ app into them. */
export default async function VehicleProjectsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  return <VehicleProjects workspaceId={workspaceId} />
}
