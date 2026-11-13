// "Discard your changes?" for forms. It covers the back arrow in the header and also
// Android's own back button or swipe, which never asks anyone.

import { useCallback, useEffect, useRef, useState } from 'react'
import { setBlocker } from './router'

export interface LeaveGuard {
  /** True while the "discard?" question is showing. */
  asking: boolean
  /** Call from the header's back arrow. Leaves at once when nothing has changed. */
  tryLeave: () => void
  /** "Keep editing". */
  stay: () => void
  /** "Discard changes". */
  discard: () => void
  /** Call right before leaving on purpose (after saving), so the guard stands down. */
  release: () => void
}

/**
 * @param dirty Whether the form holds changes that are not saved.
 * @param leave How to leave the page, for example () => back('/settings').
 */
export function useLeaveGuard(dirty: boolean, leave: () => void): LeaveGuard {
  const [asking, setAsking] = useState(false)
  const allowed = useRef(false)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const leaveRef = useRef(leave)
  leaveRef.current = leave

  useEffect(() => {
    // The router calls this when the phone's back button is used. Returning true keeps
    // the page (and everything typed) in place; then we ask.
    setBlocker(() => {
      if (allowed.current || !dirtyRef.current) return false
      setAsking(true)
      return true
    })
    const onUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current && !allowed.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      setBlocker(null)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  const release = useCallback(() => {
    allowed.current = true
  }, [])

  const tryLeave = useCallback(() => {
    if (dirtyRef.current) setAsking(true)
    else {
      allowed.current = true
      leaveRef.current()
    }
  }, [])

  const stay = useCallback(() => setAsking(false), [])

  const discard = useCallback(() => {
    allowed.current = true
    setAsking(false)
    leaveRef.current()
  }, [])

  return { asking, tryLeave, stay, discard, release }
}
