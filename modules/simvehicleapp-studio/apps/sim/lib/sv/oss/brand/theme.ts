import { getBrandConfig } from '@/lib/sv/oss/brand/config'

/**
 * CSS overriding the accent variables declared in `app/_styles/globals.css` with the brand colours.
 * Returns an empty string when no primary colour is configured, so the caller injects nothing.
 */
export function generateThemeCSS(): string {
  const theme = getBrandConfig().theme
  if (!theme?.primaryColor) return ''
  const vars = [`--brand-accent:${theme.primaryColor}`]
  if (theme.primaryHoverColor) vars.push(`--brand-accent-hover:${theme.primaryHoverColor}`)
  return `:root,.dark{${vars.join(';')}}`
}
