/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { Hammer } from 'lucide-react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SV_ACTION_FLASH_MS,
  SvActionButton,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

type Props = Partial<Parameters<typeof SvActionButton>[0]>
const draw = (props: Props = {}) =>
  act(() =>
    root.render(
      <SvActionButton action='syncode' label='SynCode' icon={Hammer} title='Generate' {...props} />
    )
  )
const button = () => container.querySelector('button') as HTMLButtonElement

describe('SvActionButton (ADR-0054)', () => {
  it('keeps its label as accessible name and data-sv-action in every state', () => {
    draw()
    expect(button().getAttribute('data-sv-action')).toBe('syncode')
    expect(button().textContent).toBe('SynCode')
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-busy')).toBeNull()
  })

  it('busy: spinner, aria-busy, busy label, cannot be pressed again', () => {
    const onClick = vi.fn()
    draw({ busy: true, busyLabel: 'SynCode…', onClick })
    expect(button().getAttribute('aria-busy')).toBe('true')
    expect(button().disabled).toBe(true)
    expect(button().textContent).toBe('SynCode…')
    expect(button().querySelector('svg')?.getAttribute('class')).toContain('animate-spin')
    act(() => button().click())
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows the outcome for a few seconds when it finishes, not before', () => {
    draw({ busy: true, outcome: 'passed' })
    expect(button().getAttribute('data-sv-flash')).toBeNull()
    draw({ busy: false, outcome: 'passed' })
    expect(button().getAttribute('data-sv-flash')).toBe('passed')
    act(() => vi.advanceTimersByTime(SV_ACTION_FLASH_MS))
    expect(button().getAttribute('data-sv-flash')).toBeNull()
    draw({ busy: true, outcome: null })
    draw({ busy: false, outcome: 'failed' })
    expect(button().getAttribute('data-sv-flash')).toBe('failed')
  })

  it('an outcome known at mount (an earlier session) is not flashed', () => {
    draw({ outcome: 'passed' })
    expect(button().getAttribute('data-sv-flash')).toBeNull()
  })

  it('primary only while it can be pressed', () => {
    draw({ primary: true })
    expect(button().getAttribute('data-sv-primary')).toBe('true')
    draw({ primary: true, disabled: true })
    expect(button().disabled).toBe(true)
  })
})
