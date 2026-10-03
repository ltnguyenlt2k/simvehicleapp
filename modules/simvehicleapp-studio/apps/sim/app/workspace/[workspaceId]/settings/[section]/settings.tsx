'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import { useSession } from '@/lib/auth/auth-client'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  isBillingEnabled,
  isCredentialSetsEnabled,
} from '@/app/workspace/[workspaceId]/settings/navigation'

const Admin = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then((m) => m.Admin)
)
const ApiKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
    (m) => m.ApiKeys
  )
)
const BYOK = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/byok/byok').then((m) => m.BYOK)
)
const CredentialSets = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/credential-sets/credential-sets').then(
    (m) => m.CredentialSets
  )
)
const Secrets = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/secrets/secrets').then((m) => m.Secrets)
)
const CustomTools = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/custom-tools/custom-tools').then(
    (m) => m.CustomTools
  )
)
const MCP = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/mcp/mcp').then((m) => m.MCP)
)
const RecentlyDeleted = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/recently-deleted/recently-deleted'
  ).then((m) => m.RecentlyDeleted)
)
const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then((m) => m.Billing)
)
const Teammates = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/teammates/teammates').then(
    (m) => m.Teammates
  )
)
const TeamManagement = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/team-management/team-management').then(
    (m) => m.TeamManagement
  )
)
const WorkflowMcpServers = dynamic(() =>
  import(
    '@/app/workspace/[workspaceId]/settings/components/workflow-mcp-servers/workflow-mcp-servers'
  ).then((m) => m.WorkflowMcpServers)
)
// SV: copilot (Chat keys), inbox (Sim mailer) and mothership sections removed with copilot (M01-T03).
// SV: Enterprise settings sections (access control, audit logs, SSO, data retention, data drains, whitelabeling) removed with apps/sim/ee.

interface SettingsPageProps {
  section: SettingsSection
}

export function SettingsPage({ section }: SettingsPageProps) {
  const { data: session, isPending: sessionLoading } = useSession()
  const posthog = usePostHog()

  const isAdminRole = session?.user?.role === 'admin'
  // The Subscription tab was replaced by Billing; redirect legacy links there.
  const normalizedSection: SettingsSection =
    (section as string) === 'subscription' ? 'billing' : section
  const effectiveSection =
    !isBillingEnabled && (normalizedSection === 'billing' || normalizedSection === 'organization')
      ? 'general'
      : normalizedSection === 'credential-sets' && !isCredentialSetsEnabled
        ? 'general'
        : normalizedSection === 'admin' && !sessionLoading && !isAdminRole
          ? 'general'
          : normalizedSection === 'mothership' && !sessionLoading && !isAdminRole
            ? 'general'
            : normalizedSection

  useEffect(() => {
    if (sessionLoading) return
    captureEvent(posthog, 'settings_tab_viewed', { section: effectiveSection })
  }, [effectiveSection, sessionLoading, posthog])

  return (
    <div className='flex h-full flex-col'>
      {effectiveSection === 'general' && <General />}
      {effectiveSection === 'secrets' && <Secrets />}
      {effectiveSection === 'credential-sets' && <CredentialSets />}
      {effectiveSection === 'apikeys' && <ApiKeys />}
      {isBillingEnabled && effectiveSection === 'billing' && <Billing />}
      {effectiveSection === 'teammates' && <Teammates />}
      {isBillingEnabled && effectiveSection === 'organization' && <TeamManagement />}
      {effectiveSection === 'byok' && <BYOK />}
      {effectiveSection === 'mcp' && <MCP />}
      {effectiveSection === 'custom-tools' && <CustomTools />}
      {effectiveSection === 'workflow-mcp-servers' && <WorkflowMcpServers />}
      {effectiveSection === 'recently-deleted' && <RecentlyDeleted />}
      {effectiveSection === 'admin' && <Admin />}
    </div>
  )
}
