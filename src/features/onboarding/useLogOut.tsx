// Logging this device out, carefully. It needs a connection (the cloud must know the
// device is gone), and it wipes the device's copy of the room, so changes that were
// never sent would be lost: those are sent first, and if some are still waiting the
// person is asked, with the number. The same goes for envelopes whose inside has not
// left this device yet (sealed here, to be opened by hand): they exist nowhere else.

import { useState, type ReactNode } from 'react'
import { db, logOut, sync } from '../../data/app'
import { isBackendError } from '../../data/backend'
import { useCopy } from '../../i18n'
import { pairingCopy } from './copy'
import { ConfirmSheet } from './parts'
import { useExplain } from './useExplain'

interface LogOut {
  /** Call from the "Log out" button. */
  start: () => void
  working: boolean
  /** Why it did not work, in words, or null. */
  problem: string | null
  /** Render this once on the page: the "lose changes?" question. */
  sheet: ReactNode
}

const waiting = () => sync.status.pending + sync.status.uploads

/** How many envelopes hold something that exists only on this device. */
async function heldHere(): Promise<number> {
  const held = await db.vault.filter((entry) => entry.held).toArray()
  return new Set(held.map((entry) => entry.envelopeId)).size
}

export function useLogOut(): LogOut {
  const c = useCopy(pairingCopy)
  const explain = useExplain()
  const [working, setWorking] = useState(false)
  const [asking, setAsking] = useState<{ unsent: number; held: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const really = async () => {
    setWorking(true)
    try {
      // On success the page reloads to the start screen.
      await logOut()
    } catch (e) {
      setAsking(null)
      setWorking(false)
      setProblem(isBackendError(e) && e.kind === 'network' ? c.logOut.needsConnection : explain(e))
    }
  }

  const start = async () => {
    setProblem(null)
    setWorking(true)
    // Always take a fresh look at the cloud first. What the app last heard may be old:
    // "offline" from a minute ago must not stop a log-out now that the connection is back.
    // The same pass sends whatever is still waiting.
    await sync.sync()
    if (sync.status.state === 'offline') {
      setWorking(false)
      return setProblem(c.logOut.needsConnection)
    }
    const held = await heldHere()
    if (waiting() > 0 || held > 0) {
      setWorking(false)
      return setAsking({ unsent: waiting(), held })
    }
    await really()
  }

  const sheet = (
    <ConfirmSheet
      open={asking !== null}
      title={c.logOut.loseTitle}
      confirmLabel={c.logOut.loseConfirm}
      cancelLabel={c.logOut.stay}
      busy={working}
      onClose={() => setAsking(null)}
      onConfirm={() => void really()}
    >
      {asking && asking.unsent > 0 && <p>{c.logOut.loseBody(asking.unsent)}</p>}
      {asking && asking.held > 0 && <p>{c.logOut.loseHeld(asking.held)}</p>}
    </ConfirmSheet>
  )

  return { start: () => void start(), working, problem, sheet }
}
