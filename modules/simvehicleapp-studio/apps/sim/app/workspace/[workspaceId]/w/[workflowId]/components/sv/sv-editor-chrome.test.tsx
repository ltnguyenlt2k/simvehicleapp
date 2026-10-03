/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  SV_ACTIONS,
  SV_DOCK_TABS,
  SV_SAFETY_NOTICE,
  SvActionBar,
  SvBottomDock,
  SvSafetyBanner,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv'

describe('vehicle editor chrome (M01-T10)', () => {
  it('renders the seven actions, all disabled with their target milestone', () => {
    const html = renderToStaticMarkup(<SvActionBar />)
    expect(SV_ACTIONS.map((a) => a.label)).toEqual([
      'Verify',
      'Simulate',
      'SynCode',
      'Run',
      'Stop',
      'Open IDE',
      'Export',
    ])
    for (const action of SV_ACTIONS) {
      expect(html).toContain(`data-sv-action="${action.id}"`)
      expect(html).toContain(`title="${action.label} — available in ${action.milestone}"`)
    }
    expect(html.match(/disabled=""/g)).toHaveLength(SV_ACTIONS.length)
  })

  it('renders the five dock tabs with the first one selected and empty', () => {
    const html = renderToStaticMarkup(<SvBottomDock />)
    expect(SV_DOCK_TABS.map((t) => t.label)).toEqual([
      'Problems',
      'Simulation timeline',
      'Run console',
      'Signals',
      'Build log',
    ])
    expect(html.match(/role="tab"/g)).toHaveLength(5)
    expect(html).toContain('aria-selected="true" ')
    expect(html).toContain('Problems — coming in M4')
  })

  it('shows the safety boundary notice (NFR-10)', () => {
    const html = renderToStaticMarkup(<SvSafetyBanner />)
    expect(SV_SAFETY_NOTICE).toMatch(/KUKSA.*ASIL/)
    expect(html).toContain('role="note"')
    expect(html).toContain('ASIL')
  })
})
