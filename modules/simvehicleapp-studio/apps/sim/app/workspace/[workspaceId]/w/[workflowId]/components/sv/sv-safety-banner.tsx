import { SV_SAFETY_NOTICE } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'

/** Permanent safety-boundary notice (NFR-10). */
export function SvSafetyBanner() {
  return (
    <div
      role='note'
      data-sv='safety-banner'
      className='flex h-[24px] flex-shrink-0 items-center justify-center border-[var(--border)] border-b bg-[var(--surface-2)] px-2 text-[11px] text-[var(--text-muted)]'
    >
      {SV_SAFETY_NOTICE}
    </div>
  )
}
