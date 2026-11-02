'use client'

import { createContext, useCallback, useContext } from 'react'
import { type SvLocale, type SvTranslate, setSvLocale, svTranslate } from '@/lib/sv/i18n'

const SvLocaleContext = createContext<SvLocale>('en')

interface SvLocaleProviderProps {
  locale: SvLocale
  children: React.ReactNode
}

/** Provides the request's locale (from the `sv-locale` cookie, read by the root layout) to the whole tree. */
export function SvLocaleProvider({ locale, children }: SvLocaleProviderProps) {
  return <SvLocaleContext.Provider value={locale}>{children}</SvLocaleContext.Provider>
}

/** Locale and translator of the current page, the same on the server and in the browser (no hydration mismatch). */
export function useSvLocale(): {
  locale: SvLocale
  t: SvTranslate
  setLocale: (l: SvLocale) => void
} {
  const locale = useContext(SvLocaleContext)
  const t = useCallback<SvTranslate>((key, vars) => svTranslate(locale, key, vars), [locale])
  return { locale, t, setLocale: setSvLocale }
}

/** Translator of the current page. */
export function useSvT(): SvTranslate {
  return useSvLocale().t
}
