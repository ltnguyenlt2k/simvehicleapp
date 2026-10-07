'use client'

import { useCallback } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import type { SvAiPendingAction } from '@/lib/api/contracts/sv-ai'
import { readSvAiEvents } from '@/lib/sv/ai-stream'
import { isWorkflowGraph } from '@/lib/sv/graph-import'
import { proposalToWorkflowState } from '@/lib/sv/proposal-state'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { fetchSvAiConversation, svAiKeys } from '@/hooks/queries/sv-ai'
import { type SvAiItem, useSvAssistantStore } from '@/stores/sv/assistant/store'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { captureBaselineSnapshot } from '@/stores/workflow-diff/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/** In-flight turn (one at a time across the panel). */
let inFlight: AbortController | null = null

/**
 * Assistant turns of the open workflow (M10-T08): each request carries the graph on the canvas and
 * the workflow's project; the BFF adds the user and relays the SSE turn into the assistant store.
 * Proposals are shown on the canvas with the workflow diff view (Accept / Reject there).
 */
export function useAssistant() {
  const queryClient = useQueryClient()
  const { project } = useWorkflowProject()
  const projectId = project?.id

  const editor = useCallback(() => {
    const { graphJson, workflowId } = useSvLintStore.getState()
    if (!workflowId || !graphJson) return null
    return {
      workflowId,
      graph: JSON.parse(graphJson) as Record<string, unknown>,
      ...(projectId ? { projectId } : {}),
    }
  }, [projectId])

  const run = useCallback(
    async (url: string, body: Record<string, unknown>, text?: string) => {
      const store = useSvAssistantStore.getState()
      if (store.streaming) return
      store.startTurn(text)
      const controller = new AbortController()
      inFlight = controller
      try {
        // boundary-raw-fetch: an assistant turn is an SSE stream answering a POST (EventSource only does GET)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null
          useSvAssistantStore
            .getState()
            .endTurn(err?.error ?? `The assistant answered ${res.status}`)
          return
        }
        await readSvAiEvents(res.body, (event) => useSvAssistantStore.getState().apply(event))
        if (useSvAssistantStore.getState().streaming) useSvAssistantStore.getState().endTurn()
      } catch (error) {
        useSvAssistantStore
          .getState()
          .endTurn(
            controller.signal.aborted
              ? 'Stopped.'
              : getErrorMessage(error, 'The assistant is unreachable')
          )
      } finally {
        if (inFlight === controller) inFlight = null
        queryClient.invalidateQueries({ queryKey: svAiKeys.lists() })
      }
    },
    [queryClient]
  )

  const send = useCallback(
    (message: string) => {
      const context = editor()
      if (!context) return
      const { conversationId } = useSvAssistantStore.getState()
      return run(
        '/api/sv/ai/chat',
        { ...context, message, ...(conversationId ? { conversationId } : {}) },
        message
      )
    },
    [editor, run]
  )

  const decide = useCallback(
    (
      action: SvAiPendingAction,
      decision: 'confirm' | 'cancel',
      editedInput?: Record<string, unknown>
    ) => {
      const context = editor()
      const { conversationId } = useSvAssistantStore.getState()
      if (!context || !conversationId) return
      useSvAssistantStore
        .getState()
        .markAction(action.actionId, decision === 'confirm' ? 'confirmed' : 'cancelled')
      return run(
        `/api/sv/ai/conversations/${encodeURIComponent(conversationId)}/actions/${encodeURIComponent(action.actionId)}/${decision}`,
        { ...context, ...(editedInput ? { editedInput } : {}) }
      )
    },
    [editor, run]
  )

  const stop = useCallback(() => inFlight?.abort(), [])

  const preview = useCallback(async (item: SvAiItem & { kind: 'proposal' }) => {
    const workflowId = useWorkflowRegistry.getState().activeWorkflowId
    const graph = item.proposal.graph
    if (!workflowId || !isWorkflowGraph(graph)) return
    const diff = useWorkflowDiffStore.getState()
    if (diff.hasActiveDiff) {
      toast.error('Accept or reject the changes on the canvas first')
      return
    }
    try {
      const current = captureBaselineSnapshot(workflowId)
      const proposed = proposalToWorkflowState(current, graph, generateId)
      await diff.setProposedChanges(proposed, undefined, { baselineWorkflow: current })
      useSvAssistantStore.getState().markProposal(item.key, 'previewed')
    } catch (error) {
      toast.error(getErrorMessage(error, 'The proposal could not be shown on the canvas'))
    }
  }, [])

  const openConversation = useCallback(async (id: string) => {
    if (useSvAssistantStore.getState().streaming) return
    try {
      useSvAssistantStore.getState().load(await fetchSvAiConversation(id))
    } catch (error) {
      toast.error(getErrorMessage(error, 'The conversation could not be loaded'))
    }
  }, [])

  return { send, decide, stop, preview, openConversation, ready: () => editor() !== null }
}
