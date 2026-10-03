import type { ReactNode } from 'react'

export interface BrandingProviderProps {
  /** Organization branding; always `null` in v1 (see `getOrgWhitelabelSettings`). */
  initialOrgSettings: null
  children: ReactNode
}

/** Pass-through provider kept for the workspace layout; branding is global in v1. */
export function BrandingProvider({ children }: BrandingProviderProps) {
  return <>{children}</>
}
