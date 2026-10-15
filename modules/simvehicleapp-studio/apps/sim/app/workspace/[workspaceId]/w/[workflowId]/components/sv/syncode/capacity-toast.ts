import { toast } from '@/components/emcn'
import { isApiClientError } from '@/lib/api/client/errors'

/** Capacity diagnostics a user fixes by cleaning or deleting apps (ADR-0053 §B). */
const CLEANABLE = new Set(['APP_QUOTA_EXCEEDED', 'HOST_DISK_LOW'])

/** First diagnostic code of an API error body (`{ error, diagnostics: [...] }`), if any. */
export function diagnosticCodeOf(error: unknown): string | undefined {
  if (!isApiClientError(error)) return undefined
  const diagnostics = (error.body as { diagnostics?: { code?: unknown }[] } | null)?.diagnostics
  const code = Array.isArray(diagnostics) ? diagnostics[0]?.code : undefined
  return typeof code === 'string' ? code : undefined
}

/**
 * Shows an error of SynCode or app creation. A full quota or a low disk gets a button to the Vehicle apps page,
 * where apps can be cleaned or deleted; a full SynCode queue only asks to try again (its message says so).
 */
export function toastSvError(error: Error, prefix: string, openVehicleApps: () => void): void {
  const code = diagnosticCodeOf(error)
  if (code && CLEANABLE.has(code)) {
    toast.error(`${prefix}: ${error.message}`, {
      action: { label: 'Open Vehicle apps', onClick: openVehicleApps },
    })
    return
  }
  toast.error(`${prefix}: ${error.message}`)
}
