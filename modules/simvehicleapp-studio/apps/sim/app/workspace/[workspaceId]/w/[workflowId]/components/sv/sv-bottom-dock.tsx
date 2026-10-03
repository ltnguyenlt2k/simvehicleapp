'use client'

import { useState } from 'react'
import { Button } from '@/components/emcn'
import {
  SV_DOCK_TABS,
  type SvDockTabId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'

interface SvBottomDockProps {
  initialTab?: SvDockTabId
}

/** Bottom dock of the vehicle editor; every tab is empty until its milestone ships. */
export function SvBottomDock({ initialTab = 'problems' }: SvBottomDockProps) {
  const [activeTab, setActiveTab] = useState<SvDockTabId>(initialTab)
  const active = SV_DOCK_TABS.find((tab) => tab.id === activeTab) ?? SV_DOCK_TABS[0]

  return (
    <div
      data-sv='bottom-dock'
      className='flex h-[160px] flex-shrink-0 flex-col border-[var(--border)] border-t bg-[var(--surface-1)]'
    >
      <div role='tablist' aria-label='Vehicle app output' className='flex gap-1 px-2 pt-1.5'>
        {SV_DOCK_TABS.map((tab) => (
          <Button
            key={tab.id}
            role='tab'
            aria-selected={tab.id === activeTab}
            variant={tab.id === activeTab ? 'active' : 'ghost'}
            size='sm'
            data-sv-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      <div
        role='tabpanel'
        className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'
      >
        {`${active.label} — coming in ${active.milestone}`}
      </div>
    </div>
  )
}
