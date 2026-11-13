// What a locked device shows instead of the app: a seal, one field, and nothing that
// tells whose room this is or what is in it.

import { useEffect, useState } from 'react'
import { PIN_LENGTH } from '../../data/pin'
import { useCopy } from '../../i18n'
import { Button } from '../../ui/components'
import { WaxSeal } from '../../ui/deco/Deco'
import { ConfirmSheet, ErrorNote } from '../onboarding/parts'
import { PinField } from '../onboarding/PinField'
import { useLogOut } from '../onboarding/useLogOut'
import { lockCopy } from './copy'
import { lockedUntil, unlock } from './lock'

/** "0:27", counting down to a moment. Null once it has come. */
export function useCountdown(until: number | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [until])
  if (until === null || until <= now) return null
  const seconds = Math.ceil((until - now) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function LockScreen() {
  const c = useCopy(lockCopy).screen
  const logOut = useLogOut()
  const [code, setCode] = useState('')
  const [triesLeft, setTriesLeft] = useState<number | null>(null)
  const [until, setUntil] = useState<number | null>(() => lockedUntil())
  const [checking, setChecking] = useState(false)
  const [asking, setAsking] = useState(false)
  const wait = useCountdown(until)

  // The wait is over: the field takes tries again.
  useEffect(() => {
    if (until !== null && wait === null) setUntil(null)
  }, [until, wait])

  const attempt = async (typed: string) => {
    if (checking || wait !== null || typed.length < PIN_LENGTH) return
    setChecking(true)
    const answer = await unlock(typed)
    setChecking(false)
    if (answer.ok) return
    setCode('')
    setTriesLeft(answer.retryAt ? null : answer.triesLeft)
    setUntil(answer.retryAt)
  }

  const trouble = wait !== null ? c.wait(wait) : triesLeft !== null ? c.wrong(triesLeft) : null

  return (
    <div className="flex min-h-dvh flex-col bg-ground" data-testid="lock-screen">
      <main className="app-column flex flex-1 flex-col items-center px-6 pb-8 pt-[max(4.5rem,env(safe-area-inset-top))] text-center">
        <WaxSeal size={112} className="drop-shadow-[0_8px_12px_#861a2b55]" />
        <h1 className="mt-6 text-2xl">{c.title}</h1>
        <div className="mt-6 w-full max-w-[21rem] text-left">
          <PinField
            label={c.label}
            value={code}
            autoFocus
            invalid={trouble !== null}
            onChange={(next) => {
              setCode(next)
              if (next.length === PIN_LENGTH) void attempt(next)
            }}
            onEnter={() => void attempt(code)}
          />
          {trouble && (
            <div className="mt-3" data-testid="lock-trouble">
              <ErrorNote>{trouble}</ErrorNote>
            </div>
          )}
        </div>
        <div className="mt-auto pt-8">
          <Button variant="quiet" onClick={() => setAsking(true)}>
            {c.forgot}
          </Button>
        </div>
        {logOut.problem && (
          <div className="mt-2 w-full">
            <ErrorNote>{logOut.problem}</ErrorNote>
          </div>
        )}
      </main>
      <ConfirmSheet
        open={asking}
        title={c.forgotTitle}
        confirmLabel={c.logOut}
        cancelLabel={c.stay}
        busy={logOut.working}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          logOut.start()
        }}
      >
        {c.forgotBody.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ConfirmSheet>
      {logOut.sheet}
      {/* No toasts here: one that was on its way when the lock fell ("Welcome back, Mia") would say too much. */}
    </div>
  )
}
