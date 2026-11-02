import { EN } from '@/lib/sv/i18n/messages/en'
import { VI } from '@/lib/sv/i18n/messages/vi'

/**
 * UI language of the studio (ADR-0072): English (default) or Vietnamese, one at a time. Strings of the user journey
 * come from the `en`/`vi` dictionaries; `vi` must have every `en` key (typed here, checked again by a test). The choice
 * lives in the `sv-locale` cookie so the server renders the right language and a change reloads the page once.
 */
export const SV_LOCALES = ['en', 'vi'] as const
export type SvLocale = (typeof SV_LOCALES)[number]
export const SV_LOCALE_COOKIE = 'sv-locale'

export type SvMessageKey = keyof typeof EN
export type SvMessageVars = Record<string, string | number>
export type SvTranslate = (key: SvMessageKey, vars?: SvMessageVars) => string

export const SV_MESSAGES: Record<SvLocale, Record<SvMessageKey, string>> = { en: EN, vi: VI }

/** Native name of each language, shown the same in both modes. */
export const SV_LOCALE_NAMES: Record<SvLocale, string> = { en: 'English', vi: 'Tiếng Việt' }

export function parseSvLocale(value: unknown): SvLocale {
  return value === 'vi' ? 'vi' : 'en'
}

/** `{name}` placeholders are replaced by `vars`; a missing key falls back to English, then to the key. */
export function svTranslate(locale: SvLocale, key: SvMessageKey, vars?: SvMessageVars): string {
  const text = SV_MESSAGES[locale][key] ?? EN[key] ?? key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

/** Locale of this page in the browser (read once: a change reloads the page); English on the server. */
let clientLocale: SvLocale | null = null
export function svClientLocale(): SvLocale {
  if (typeof document === 'undefined') return 'en'
  if (clientLocale === null) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${SV_LOCALE_COOKIE}=([^;]*)`))
    clientLocale = parseSvLocale(match?.[1])
  }
  return clientLocale
}

/** Translate outside React (stores, block registry, toasts in callbacks): the browser page's locale. */
export const svT: SvTranslate = (key, vars) => svTranslate(svClientLocale(), key, vars)

/** Saves the choice and reloads, so every surface (blocks, cached lists) renders in the new language. */
export function setSvLocale(locale: SvLocale) {
  document.cookie = `${SV_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
  window.location.reload()
}

/** `1 error` / `2 errors`: picks the `.one` or `.other` key and passes `n`. */
export function svPlural(
  t: SvTranslate,
  n: number,
  one: SvMessageKey,
  other: SvMessageKey,
  vars?: SvMessageVars
): string {
  return t(n === 1 ? one : other, { n, ...vars })
}
