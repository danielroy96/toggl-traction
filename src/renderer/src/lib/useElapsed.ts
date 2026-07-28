import { useEffect, useState } from 'react'
import { elapsedSeconds } from './format.js'

/**
 * Ticks once per second and returns the elapsed seconds since `startIso`.
 * Returns 0 when `startIso` is null so callers can render a stopped state.
 */
export function useElapsed(startIso: string | null | undefined): number {
  const [seconds, setSeconds] = useState(() =>
    startIso ? elapsedSeconds(startIso) : 0
  )

  useEffect(() => {
    if (!startIso) {
      setSeconds(0)
      return
    }
    setSeconds(elapsedSeconds(startIso))
    const id = setInterval(() => setSeconds(elapsedSeconds(startIso)), 1000)
    return () => clearInterval(id)
  }, [startIso])

  return seconds
}
