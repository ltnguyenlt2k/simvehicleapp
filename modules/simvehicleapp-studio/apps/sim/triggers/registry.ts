import {
  circlebackMeetingCompletedTrigger,
  circlebackMeetingNotesTrigger,
  circlebackWebhookTrigger,
} from '@/triggers/circleback'
import { genericWebhookTrigger } from '@/triggers/generic'
import { rssPollingTrigger } from '@/triggers/rss'
import { simWorkspaceEventTrigger } from '@/triggers/sim'
import { tableNewRowTrigger } from '@/triggers/table'
import type { TriggerRegistry } from '@/triggers/types'

export const TRIGGER_REGISTRY: TriggerRegistry = {
  generic_webhook: genericWebhookTrigger,
  circleback_meeting_completed: circlebackMeetingCompletedTrigger,
  circleback_meeting_notes: circlebackMeetingNotesTrigger,
  circleback_webhook: circlebackWebhookTrigger,
  rss_poller: rssPollingTrigger,
  sim_workspace_event: simWorkspaceEventTrigger,
  table_new_row: tableNewRowTrigger,
}
