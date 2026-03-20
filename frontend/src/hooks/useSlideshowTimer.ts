import { useEffect, useRef } from 'react'

/**
 * Calls `onTick` every `intervalMs` while `playing` is true.
 * Automatically clears the interval when paused or on unmount.
 */
export function useSlideshowTimer(
  onTick: () => void,
  intervalMs: number,
  playing: boolean,
) {
  // Keep a stable ref so the effect doesn't re-run when the caller re-renders.
  const tickRef = useRef(onTick)
  tickRef.current = onTick

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => tickRef.current(), intervalMs)
    return () => clearInterval(id)
  }, [playing, intervalMs])
}
