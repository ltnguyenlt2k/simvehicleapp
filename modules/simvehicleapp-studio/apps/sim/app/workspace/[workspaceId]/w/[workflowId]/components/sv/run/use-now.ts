import { useEffect, useState } from 'react'

/** The wall clock, refreshed every `everyMs` while `enabled` (time left of a run). */
export function useNow(everyMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs, enabled])
  return now
}
