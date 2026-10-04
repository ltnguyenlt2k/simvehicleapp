/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SvVssNode } from '@/lib/api/contracts/sv'
import {
  formatVssDomain,
  formatVssType,
  searchKindFilter,
  vssSelectability,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'
import {
  VssNodeCard,
  VssNodeRow,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-node-view'

const speed: SvVssNode = {
  path: 'Vehicle.Speed',
  name: 'Speed',
  kind: 'sensor',
  datatype: 'float',
  unit: 'km/h',
  description: 'Vehicle speed.',
}
const hazard: SvVssNode = {
  path: 'Vehicle.Body.Lights.Hazard.IsSignaling',
  name: 'IsSignaling',
  kind: 'actuator',
  datatype: 'boolean',
}
const wiping: SvVssNode = {
  path: 'Vehicle.Body.Windshield.Front.Wiping.Mode',
  name: 'Mode',
  kind: 'actuator',
  datatype: 'string',
  allowed: ['OFF', 'SLOW', 'MEDIUM', 'FAST', 'INTERVAL', 'RAIN_SENSOR'],
}
const pids: SvVssNode = {
  path: 'Vehicle.OBD.PidsA',
  name: 'PidsA',
  kind: 'attribute',
  datatype: 'string[]',
}
const cabin: SvVssNode = { path: 'Vehicle.Cabin', name: 'Cabin', kind: 'branch', hasChildren: true }
const refuel: SvVssNode = {
  path: 'Vehicle.Body.RefuelPosition',
  name: 'RefuelPosition',
  kind: 'attribute',
  datatype: 'string',
  deprecation: 'v4.1 replaced with Vehicle.Powertrain.TractionBattery.Charging.ChargePortPosition',
}

describe('vss-format (M02-T07)', () => {
  it('formats type, unit and array types', () => {
    expect(formatVssType(speed)).toBe('float · km/h')
    expect(formatVssType(hazard)).toBe('boolean')
    expect(formatVssType(pids)).toBe('string[]')
    expect(formatVssType(cabin)).toBe('')
  })

  it('formats the value domain from allowed or min/max', () => {
    expect(formatVssDomain(wiping)).toBe('OFF, SLOW, MEDIUM, FAST, … (6)')
    expect(formatVssDomain({ min: 0, max: 100 })).toBe('0 … 100')
    expect(formatVssDomain({ min: 0 })).toBe('≥ 0')
    expect(formatVssDomain(speed)).toBe('')
  })

  it('only offers the kinds the block allows; sensors are never writable', () => {
    const set = ['actuator'] as const
    expect(vssSelectability(hazard, set, { writes: true })).toEqual({ selectable: true })
    expect(vssSelectability(speed, set, { writes: true })).toEqual({
      selectable: false,
      reason: 'This block needs a actuator',
    })
    expect(vssSelectability(speed, ['sensor', 'actuator']).selectable).toBe(true)
    expect(vssSelectability(pids, ['attribute']).selectable).toBe(true)
    expect(vssSelectability({ ...pids, kind: 'actuator' }, set, { writes: true })).toEqual({
      selectable: false,
      reason: 'Array signals are read-only',
    })
    expect(vssSelectability(cabin, set)).toEqual({ selectable: false })
  })

  it('filters search by kind on the server only for a single kind', () => {
    expect(searchKindFilter(['actuator'])).toBe('actuator')
    expect(searchKindFilter(['sensor', 'actuator'])).toBeUndefined()
  })
})

describe('VssNodeRow', () => {
  it('renders a branch as an expandable tree item', () => {
    const html = renderToStaticMarkup(
      <VssNodeRow node={cabin} depth={0} expanded selectability={{ selectable: false }} />
    )
    expect(html).toContain('role="treeitem"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('>Cabin<')
  })

  it('disables a leaf the block cannot use and explains why', () => {
    const html = renderToStaticMarkup(
      <VssNodeRow
        node={speed}
        depth={2}
        selectability={vssSelectability(speed, ['actuator'], { writes: true })}
      />
    )
    expect(html).toContain('disabled=""')
    expect(html).toContain('title="This block needs a actuator"')
    expect(html).toContain('float · km/h')
    expect(html).toContain('data-sv-kind="sensor"')
    expect(html).toContain('pl-7')
  })

  it('shows the full path for search results and the [ ] tag for arrays', () => {
    const html = renderToStaticMarkup(
      <VssNodeRow node={pids} depth={0} showPath selectability={{ selectable: true }} />
    )
    expect(html).toContain('>Vehicle.OBD.PidsA<')
    expect(html).toContain('[ ]')
    expect(html).toContain('string[]')
  })
})

describe('VssNodeCard (locked path)', () => {
  it('shows type, allowed values and a Change action', () => {
    const html = renderToStaticMarkup(
      <VssNodeCard path={wiping.path} node={wiping} onChange={() => {}} />
    )
    expect(html).toContain('data-sv-path="Vehicle.Body.Windshield.Front.Wiping.Mode"')
    expect(html).toContain('Values: OFF, SLOW, MEDIUM, FAST, … (6)')
    expect(html).toContain('>Change<')
  })

  it('has no Change action in preview/read-only mode', () => {
    const html = renderToStaticMarkup(<VssNodeCard path={speed.path} node={speed} />)
    expect(html).not.toContain('>Change<')
    expect(html).toContain('Vehicle speed.')
  })

  it('flags a path missing from the release and deprecated signals', () => {
    const missing = renderToStaticMarkup(
      <VssNodeCard path='Vehicle.Gone' node={null} release='v4.2' />
    )
    expect(missing).toContain('role="alert"')
    expect(missing).toContain('Not found in VSS v4.2')
    const deprecated = renderToStaticMarkup(<VssNodeCard path={refuel.path} node={refuel} />)
    expect(deprecated).toContain('Deprecated')
    expect(deprecated).toContain('v4.1 replaced with')
  })
})
