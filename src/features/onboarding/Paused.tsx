// The whole screen while the admin has paused this seat. Nothing can be read or changed
// until it is switched on again; the sync engine keeps asking and carries on by itself.

import { MotionConfig } from 'motion/react'
import { useRef, useState } from 'react'
import { sync, useSyncStatus } from '../../data/app'
import { useMembers } from '../../data/queries'
import { useCopy } from '../../i18n'
import { Button, toast } from '../../ui/components'
import { Candle } from '../../ui/deco/Deco'
import { pairingCopy } from './copy'
import { ErrorNote } from './parts'
import { useLogOut } from './useLogOut'

/**
 * True while the admin has paused this seat. The sync engine reports "syncing" at the
 * start of every pass, also while paused, so this remembers what the last finished pass
 * said: the paused screen must not blink away each time the engine asks again.
 */
export function usePaused(): boolean {
  const { state } = useSyncStatus()
  const settled = useRef(state)
  if (state !== 'syncing') settled.current = state
  return settled.current === 'paused'
}

export function PausedScreen() {
  const c = useCopy(pairingCopy)
  const members = useMembers()
  const admin = members?.find((m) => m.isAdmin)
  const logOut = useLogOut()
  const [checking, setChecking] = useState(false)

  const check = async () => {
    setChecking(true)
    await sync.sync()
    setChecking(false)
    toast(sync.status.state === 'paused' ? c.paused.still : c.paused.back)
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-dvh flex-col bg-ground" data-testid="paused">
        <main className="app-column flex flex-1 flex-col items-center px-6 pb-8 pt-[max(4rem,env(safe-area-inset-top))] text-center">
          <Candle size={124} lit={false} />
          <h1 className="mt-5 text-2xl">{c.paused.title}</h1>
          <p className="mt-3 text-pretty text-sm text-ink-soft">{c.paused.body(admin?.name ?? c.paused.theAdmin)}</p>
          <div className="mt-7 flex w-full flex-col items-center gap-3">
            <Button size="lg" block disabled={checking} onClick={() => void check()}>
              {c.paused.check}
            </Button>
            {logOut.problem && <ErrorNote>{logOut.problem}</ErrorNote>}
            <Button variant="quiet" disabled={logOut.working} onClick={logOut.start}>
              {c.paused.logOut}
            </Button>
          </div>
        </main>
        {logOut.sheet}
      </div>
    </MotionConfig>
  )
}
