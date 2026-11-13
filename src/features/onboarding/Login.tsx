// "Back to the room": logging in with name and PIN. The same form is used on the
// log-in page and on the screen a device shows after it was logged out from elsewhere.

import { useState } from 'react'
import { useSyncStatus } from '../../data/app'
import { useCopy } from '../../i18n'
import { Button, Field } from '../../ui/components'
import { Candle } from '../../ui/deco/Deco'
import { pairingCopy } from './copy'
import { ConfirmSheet, ErrorNote, StepPage } from './parts'
import { PinField } from './PinField'

interface FormProps {
  name: string
  pin: string
  onName: (name: string) => void
  onPin: (pin: string) => void
  /** Red boxes on the PIN while a problem is showing. */
  invalid: boolean
  onSubmit: () => void
}

function LoginFields({ name, pin, onName, onPin, invalid, onSubmit }: FormProps) {
  const c = useCopy(pairingCopy)
  return (
    <div className="flex flex-col gap-5 text-left">
      <Field
        label={c.login.nameLabel}
        value={name}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        onChange={(e) => onName(e.target.value)}
      />
      <PinField label={c.login.pinLabel} value={pin} onChange={onPin} invalid={invalid} onEnter={onSubmit} enterKeyHint="go" />
    </div>
  )
}

interface PageProps extends Omit<FormProps, 'invalid'> {
  problem: string | null
}

/** The log-in page, reached from the start screen. */
export function LoginPage({ problem, ...form }: PageProps) {
  const c = useCopy(pairingCopy)
  return (
    <StepPage
      title={c.login.title}
      footer={
        <>
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <Button size="lg" block onClick={form.onSubmit}>
            {c.login.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-4" data-testid="login">
        <div className="flex items-center gap-4">
          <Candle size={64} className="shrink-0" />
          <p className="text-base text-ink-soft">{c.login.lead}</p>
        </div>
        <LoginFields {...form} invalid={Boolean(problem)} />
        <p className="text-xs leading-snug text-ink-soft">{c.login.help}</p>
      </div>
    </StepPage>
  )
}

interface LockedOutProps extends PageProps {
  onHaveCode: () => void
  /** Forget the room on this device and show the start again. */
  onStartOver: () => void
}

/** Shown when the cloud says this device is no longer logged in. Everything on it is kept until the person decides. */
export function LockedOut({ problem, onHaveCode, onStartOver, ...form }: LockedOutProps) {
  const c = useCopy(pairingCopy)
  const status = useSyncStatus()
  const [asking, setAsking] = useState(false)
  const [working, setWorking] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col bg-ground" data-testid="locked-out">
      <main className="app-column flex flex-1 flex-col items-center px-5 pb-8 pt-[max(2.5rem,env(safe-area-inset-top))] text-center">
        <Candle size={104} lit={false} />
        <h1 className="mt-4 text-2xl">{c.lockedOut.title}</h1>
        <p className="mt-3 text-pretty text-sm text-ink-soft">{c.lockedOut.body}</p>
        <div className="mt-6 flex w-full flex-col gap-4">
          <LoginFields {...form} invalid={Boolean(problem)} />
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <Button size="lg" block onClick={form.onSubmit}>
            {c.login.submit}
          </Button>
        </div>
        <p className="mt-4 text-balance text-xs leading-snug text-ink-soft">{c.login.help}</p>
        <div className="mt-3 flex flex-col items-center">
          <Button variant="quiet" onClick={onHaveCode}>
            {c.lockedOut.haveCode}
          </Button>
          <Button variant="quiet" onClick={() => setAsking(true)}>
            {c.lockedOut.startOver}
          </Button>
        </div>
      </main>
      <ConfirmSheet
        open={asking}
        title={c.lockedOut.startOverTitle}
        confirmLabel={c.lockedOut.startOverConfirm}
        cancelLabel={c.lockedOut.keep}
        busy={working}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setWorking(true)
          onStartOver()
        }}
      >
        <p>{c.lockedOut.startOverBody(status.pending + status.uploads)}</p>
      </ConfirmSheet>
    </div>
  )
}
