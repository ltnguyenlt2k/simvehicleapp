import type { Metadata } from 'next'
import { getBrandConfig } from '@/lib/sv/oss/brand/config'

/** Product description used in metadata. */
export const SV_BRAND_DESCRIPTION = 'Model, build and run vehicle apps for real vehicles.'

/** Root Next.js metadata for the studio, branded from {@link getBrandConfig}. */
export function generateBrandedMetadata(): Metadata {
  const brand = getBrandConfig()
  const description = SV_BRAND_DESCRIPTION
  return {
    title: { default: brand.name, template: `%s | ${brand.name}` },
    description,
    applicationName: brand.name,
    icons: {
      icon: brand.faviconUrl
        ? [{ url: brand.faviconUrl }]
        : [
            { url: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
            { url: '/favicon/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
            { url: '/favicon/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
          ],
      apple: '/favicon/apple-touch-icon.png',
    },
    openGraph: { title: brand.name, description, siteName: brand.name, type: 'website' },
  }
}
