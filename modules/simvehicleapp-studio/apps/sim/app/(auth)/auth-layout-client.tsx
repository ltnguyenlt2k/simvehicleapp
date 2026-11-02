'use client'

import { useEffect } from 'react'
import { SvLanguageSwitch } from '@/lib/sv/i18n/language-switch'
import AuthBackground from '@/app/(auth)/components/auth-background'
import Navbar from '@/app/(landing)/components/navbar/navbar'

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <header className='relative shrink-0 bg-[var(--landing-bg)]'>
          <Navbar logoOnly />
          {/* SV: language of the studio, chosen before signing in (ADR-0072) */}
          <SvLanguageSwitch className='absolute top-1/2 right-6 -translate-y-1/2' />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>{children}</div>
        </div>
      </main>
    </AuthBackground>
  )
}
