import { useCallback, useRef } from 'react'

/**
 * Remount key for an editor that keeps a local draft: it changes only when the stored value changes
 * from elsewhere (collaborator, undo, preset), never because of this editor's own commit — remounting
 * on our own commit would close an open dropdown or drop focus mid-edit (found by the M3 E2E).
 * Uses the render-time `prev` ref idiom (.claude/rules/sim-hooks.md), no syncing effect.
 */
export function useExternalEditKey(value: unknown): {
  key: number
  markCommitted: (next: unknown) => void
} {
  const serialized = JSON.stringify(value ?? null)
  const committed = useRef(serialized)
  const version = useRef(0)
  if (serialized !== committed.current) {
    committed.current = serialized
    version.current += 1
  }
  const markCommitted = useCallback((next: unknown) => {
    committed.current = JSON.stringify(next ?? null)
  }, [])
  return { key: version.current, markCommitted }
}
