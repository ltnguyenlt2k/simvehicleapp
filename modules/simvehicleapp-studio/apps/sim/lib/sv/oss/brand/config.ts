import { getEnv } from '@/lib/core/config/env'

/**
 * Brand settings read by the Apache-licensed Sim code (clean-room replacement of the removed
 * Enterprise whitelabeling module, spec: docs/specs/M01-T02a-oss-clean-room-spec.md §2).
 */
export interface BrandTheme {
  primaryColor?: string
  primaryHoverColor?: string
  accentColor?: string
  accentHoverColor?: string
  backgroundColor?: string
}

export interface BrandConfig {
  name: string
  supportEmail: string
  logoUrl?: string
  faviconUrl?: string
  customCssUrl?: string
  documentationUrl: string
  theme?: BrandTheme
  isWhitelabeled: boolean
}

/** SimVehicleApp defaults; `primaryColor` is the median colour of the brand mark (brand/README.md). */
export const SV_BRAND_DEFAULTS = {
  name: 'SimVehicleApp',
  supportEmail: 'support@simvehicleapp.local',
  primaryColor: '#0FC0FF',
  primaryHoverColor: '#0AA3DB',
  documentationUrl: 'https://github.com/ltnguyenlt2k/simvehicleapp#readme',
} as const

/**
 * Returns the brand configuration from the public `NEXT_PUBLIC_BRAND_*` variables (server and client),
 * falling back to the SimVehicleApp defaults. Pure and deterministic for a given environment.
 */
export function getBrandConfig(): BrandConfig {
  const primaryColor = getEnv('NEXT_PUBLIC_BRAND_PRIMARY_COLOR') || SV_BRAND_DEFAULTS.primaryColor
  return {
    name: getEnv('NEXT_PUBLIC_BRAND_NAME') || SV_BRAND_DEFAULTS.name,
    supportEmail: getEnv('NEXT_PUBLIC_SUPPORT_EMAIL') || SV_BRAND_DEFAULTS.supportEmail,
    logoUrl: getEnv('NEXT_PUBLIC_BRAND_LOGO_URL') || undefined,
    faviconUrl: getEnv('NEXT_PUBLIC_BRAND_FAVICON_URL') || undefined,
    customCssUrl: getEnv('NEXT_PUBLIC_CUSTOM_CSS_URL') || undefined,
    documentationUrl: getEnv('NEXT_PUBLIC_DOCUMENTATION_URL') || SV_BRAND_DEFAULTS.documentationUrl,
    theme: {
      primaryColor,
      primaryHoverColor:
        getEnv('NEXT_PUBLIC_BRAND_PRIMARY_HOVER_COLOR') ||
        (primaryColor === SV_BRAND_DEFAULTS.primaryColor
          ? SV_BRAND_DEFAULTS.primaryHoverColor
          : undefined),
      accentColor: getEnv('NEXT_PUBLIC_BRAND_ACCENT_COLOR') || undefined,
      accentHoverColor: getEnv('NEXT_PUBLIC_BRAND_ACCENT_HOVER_COLOR') || undefined,
      backgroundColor: getEnv('NEXT_PUBLIC_BRAND_BACKGROUND_COLOR') || undefined,
    },
    isWhitelabeled: true,
  }
}

/** Client-side access to the brand configuration (same values as {@link getBrandConfig}). */
export function useBrandConfig(): BrandConfig {
  return getBrandConfig()
}

/** Organization-level branding is not supported in v1; always resolves to `null`. */
export async function getOrgWhitelabelSettings(_organizationId: string): Promise<null> {
  return null
}
