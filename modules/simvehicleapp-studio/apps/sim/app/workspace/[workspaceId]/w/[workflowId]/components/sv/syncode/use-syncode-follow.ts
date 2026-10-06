'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { svLogLineSchema } from '@/lib/api/contracts/sv'
import { svProjectKeys, useSvGeneration } from '@/hooks/queries/sv-projects'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

const isRunning = (state?: string) => state === 'queued' || state === 'running'

/**
 * Follows the generation started by SynCode (M07-T18): streams its build log over SSE into the
 * store (the browser resumes after `Last-Event-ID` on a drop) until the generation ends, then
 * reports the result once and refreshes the generated files.
 */
export function useSynCodeFollow() {
  const queryClient = useQueryClient()
  const projectId = useSvSynCodeStore((s) => s.projectId)
  const generationId = useSvSynCodeStore((s) => s.generationId)
  const { data: generation } = useSvGeneration(projectId ?? undefined, generationId ?? undefined)
  const running = isRunning(generation?.state)
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (!projectId || !generationId || !running) return
    const source = new EventSource(
      `/api/sv/projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/events`
    )
    source.addEventListener('log', (event) => {
      const parsed = svLogLineSchema.safeParse(JSON.parse((event as MessageEvent<string>).data))
      if (parsed.success) useSvSynCodeStore.getState().append(generationId, [parsed.data])
    })
    source.onerror = () => {
      // The stream closes when the generation ends: check before the browser reconnects.
      queryClient.invalidateQueries({
        queryKey: svProjectKeys.generation(projectId, generationId),
      })
    }
    return () => source.close()
  }, [projectId, generationId, running, queryClient])

  useEffect(() => {
    if (!generation || isRunning(generation.state) || reported.current === generation.id) return
    reported.current = generation.id
    queryClient.invalidateQueries({ queryKey: svProjectKeys.files(generation.projectId) })
    if (generation.state === 'succeeded') {
      toast.success('SynCode passed: IR, format, compile and tests')
    } else if (generation.state === 'failed') {
      const first = generation.diagnostics[0]
      toast.error(
        `SynCode failed at ${generation.stage ?? 'a stage'}${first ? `: ${first.code}` : ''}`
      )
      useSvSynCodeStore.getState().showBuildLog()
    }
  }, [generation, queryClient])

  return { generation, running }
}
