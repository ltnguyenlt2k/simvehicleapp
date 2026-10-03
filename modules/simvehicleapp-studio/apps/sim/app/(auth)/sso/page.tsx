import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Single Sign-On',
}

export const dynamic = 'force-dynamic'

// SV: SSO configuration/login UI was Enterprise-only (removed with apps/sim/ee); clean-room UI arrives in M11 (ADR-0032).
export default async function SSOPage() {
  redirect('/login')
}
