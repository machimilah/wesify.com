import { useEffect, useRef, useState } from 'react'
import { userCount } from '../engine/statsClient'

/**
 * How many people have signed up, kept current and counted up to rather than swapped.
 *
 * Two separate numbers live here and conflating them is the bug this is written to avoid: `target`
 * is what the server last said, and `shown` is what the digits currently read. The poll only ever
 * moves the target; the animation walks `shown` towards it, so a reply arriving mid-count redirects
 * the run in progress instead of restarting it from zero.
 *
 * Polling rather than a socket: it is one integer on a public page, the server caches it for a few
 * seconds, and a connection held open per visitor would cost more than the number is worth.
 */

// Two seconds, so a change in the database shows on screen about as fast as somebody switching
// between the two can notice. The reply is one integer and the server caches it, so this is cheap.
const POLL_MS = 2_000
const RUN_MS = 900

export function UserCount() {
  const [target, setTarget] = useState<number | null>(null)
  const [shown, setShown] = useState(0)
  // Read inside the animation frame, which would otherwise close over the value from the render that
  // started it and animate away from a number that is no longer on screen.
  const shownRef = useRef(0)

  useEffect(() => {
    let stopped = false
    const read = () => void userCount().then(count => { if (!stopped && count !== null) setTarget(count) })
    read()
    // Paused while the tab is hidden: a background tab that nobody is looking at has no reason to
    // ask, and browsers throttle the timer there anyway.
    const timer = setInterval(() => { if (!document.hidden) read() }, POLL_MS)
    const onVisible = () => { if (!document.hidden) read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    if (target === null) return
    const from = shownRef.current
    if (from === target) return
    const startedAt = performance.now()
    let frame = 0
    const step = (now: number) => {
      // Eased out, so the count slows into its final value instead of stopping dead on it.
      const progress = Math.min(1, (now - startedAt) / RUN_MS)
      const eased = 1 - (1 - progress) ** 3
      const value = Math.round(from + (target - from) * eased)
      shownRef.current = value
      setShown(value)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return <div style={{ marginTop: '60px', textAlign: 'center' }} data-testid="user-count" data-users={target ?? ''}>
    <div style={{ color: '#fff', fontSize: '18px' }}>User count</div>
    {/* Tabular figures, so a digit changing every frame does not shift the width of the number. */}
    <div style={{ color: '#fff', fontSize: '72px', fontWeight: 'bold', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
      {target === null ? '—' : shown.toLocaleString()}
    </div>
  </div>
}
