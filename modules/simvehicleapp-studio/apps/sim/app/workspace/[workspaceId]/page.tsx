import { redirect } from 'next/navigation'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  // SV: the Mothership chat home was removed with copilot (M01-T03); land on the workflows list.
  redirect(`/workspace/${workspaceId}/w`)
}
