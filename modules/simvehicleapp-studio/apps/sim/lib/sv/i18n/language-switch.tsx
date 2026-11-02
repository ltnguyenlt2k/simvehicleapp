'use client'

import { Languages } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import { SV_LOCALE_NAMES, SV_LOCALES } from '@/lib/sv/i18n'
import { useSvLocale } from '@/lib/sv/i18n/locale-provider'

interface SvLanguageSwitchProps {
  className?: string
}

/** Compact EN | VI switch (sign-in pages); Settings > General has the full selector. */
export function SvLanguageSwitch({ className }: SvLanguageSwitchProps) {
  const { locale, t, setLocale } = useSvLocale()
  return (
    <div
      role='group'
      aria-label={t('language.label')}
      data-sv='language-switch'
      className={cn('flex items-center gap-1 text-caption', className)}
    >
      <Languages aria-hidden className='size-[14px] text-[var(--text-icon)]' />
      {SV_LOCALES.map((l) => (
        <button
          key={l}
          type='button'
          lang={l}
          aria-pressed={l === locale}
          data-sv-locale={l}
          title={SV_LOCALE_NAMES[l]}
          onClick={() => l !== locale && setLocale(l)}
          className={cn(
            'rounded-sm px-1.5 py-0.5 uppercase transition-colors',
            l === locale
              ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]'
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
