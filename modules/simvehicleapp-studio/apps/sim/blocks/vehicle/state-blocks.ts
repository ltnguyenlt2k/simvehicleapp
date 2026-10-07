import type { BlockConfig } from '@/blocks/types'
import { blockFromSpec } from '@/blocks/vehicle/factory'
import { SV_BLOCK_COLORS as C, SvIcons as I } from '@/blocks/vehicle/icons'

/** Filter and state machine (ADR-0049): state that lives across runs. */
export const SV_STATE_BLOCKS: Record<string, BlockConfig> = {
  sv_filter: blockFromSpec('sv_filter', {
    name: 'Filter',
    description: 'Smooth a noisy value: moving average, low-pass or median.',
    longDescription:
      'Adds the value as a sample each time it runs and returns the filtered value. The samples are kept while the app runs.',
    icon: I.filter,
    bgColor: C.state,
    props: {
      mode: {
        title: 'Filter',
        labels: {
          'moving-average': 'Moving average',
          exponential: 'Low-pass (exponential)',
          median: 'Median',
        },
      },
      window: { title: 'Samples' },
      alpha: { title: 'Smoothing (0–1)' },
    },
  }),
  sv_state_machine: blockFromSpec('sv_state_machine', {
    name: 'State machine',
    description: 'Move a state variable from one state to the next when a condition holds.',
    longDescription:
      'Checks the transitions in order and applies the first one whose From matches the current state and whose When is true. An empty From matches any state.',
    icon: I.stateMachine,
    bgColor: C.state,
    props: {
      name: { title: 'State variable', variablePicker: true },
      transitions: { title: 'Transitions' },
    },
    handles: [
      { id: 'changed', label: 'changed' },
      { id: 'unchanged', label: 'unchanged' },
    ],
  }),
}
