// "Notifications": on or off for this device, and one switch for each kind of news.
// Permission is asked for only after a tap on "Turn on notifications", never on its own.

import { useEffect, useState } from 'react'
import { push } from '../../data/app'
import { PUSH_TYPES, type PushType } from '../../data/backend'
import type { PushProblem } from '../../data/push'
import { usePartner } from '../../data/queries'
import { useCopy, useT } from '../../i18n'
import { usePush } from '../../pwa/notifications'
import { Button, buzz, Card, Tag, toast, Toggle } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { ErrorNote, StepPage, WarningNote } from '../onboarding/parts'
import { deviceCopy } from './deviceCopy'

export function NotificationsPage() {
  const c = useCopy(deviceCopy).notifications
  const t = useT()
  const { status, muted } = usePush()
  const partner = usePartner()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<PushProblem | null>(null)
  /** True once the cloud has been asked (or could not be reached) since this page opened. */
  const [asked, setAsked] = useState(false)
  const who = partner?.name ?? c.partner

  // Ask the cloud whether notifications are set up, and look at what the browser really
  // holds: what this device remembers may be old. And again on coming back, for example
  // from lifting a block in the browser's settings.
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === 'visible') void push.refresh(true).finally(() => setAsked(true))
    }
    look()
    document.addEventListener('visibilitychange', look)
    return () => document.removeEventListener('visibilitychange', look)
  }, [])

  const turnOn = async () => {
    setBusy(true)
    setProblem(null)
    const trouble = await push.turnOn()
    setBusy(false)
    // "Blocked" is shown by the page itself from now on.
    if (trouble && trouble !== 'blocked') return setProblem(trouble)
    if (!trouble) {
      buzz(12)
      toast(c.turnedOn)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setProblem(null)
    await push.turnOff()
    setBusy(false)
    toast(c.turnedOff)
  }

  const setKind = async (type: PushType, wanted: boolean) => {
    const told = await push.setMuted(type, !wanted)
    if (!told) toast(c.savedLater)
  }

  return (
    <StepPage title={c.title} backTo="/settings">
      <div className="flex flex-col gap-7 px-4" data-testid="notifications-page">
        <Card pad={false} className="flex flex-col gap-3 p-4" data-testid="notifications-device" data-status={status}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">{c.heading}</h2>
              {(status === 'on' || status === 'off' || status === 'blocked') && (
                <p className="mt-1.5" data-testid="notifications-tag">
                  <Tag tone={status === 'on' ? 'moss' : status === 'blocked' ? 'gold' : 'haze'}>{status === 'on' ? c.on : status === 'blocked' ? c.blockedTag : c.off}</Tag>
                </p>
              )}
            </div>
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-haze text-accent" aria-hidden>
              <Icon name="bell" size={24} />
            </span>
          </div>

          {status === 'unknown' && <p className="text-sm text-ink-soft">{asked ? c.cannotAsk : t.loading}</p>}
          {status === 'unconfigured' && <p className="text-sm text-ink-soft">{c.unconfigured}</p>}
          {status === 'unsupported' && <p className="text-sm text-ink-soft">{c.unsupported}</p>}
          {status === 'blocked' && <WarningNote>{c.blocked}</WarningNote>}
          {status === 'off' && <p className="text-sm text-ink-soft">{c.leadOff(who)}</p>}
          {status === 'on' && <p className="text-sm text-ink-soft">{c.leadOn(who)}</p>}
          {(status === 'on' || status === 'off') && <p className="text-xs leading-snug text-ink-soft">{c.discreet}</p>}

          {problem && <ErrorNote>{c.problems[problem]}</ErrorNote>}

          {status === 'off' && (
            <Button size="lg" block disabled={busy} onClick={() => void turnOn()}>
              {c.turnOn}
            </Button>
          )}
          {status === 'on' && (
            <Button variant="secondary" block disabled={busy} onClick={() => void turnOff()}>
              {c.turnOff}
            </Button>
          )}
        </Card>

        {status === 'on' && (
          <section aria-labelledby="kinds-title">
            <h2 id="kinds-title" className="px-1 text-lg">
              {c.kindsTitle}
            </h2>
            <p className="mb-2.5 mt-1 px-1 text-xs text-ink-soft">{c.kindsHint}</p>
            <Card pad={false} className="divide-y divide-line px-4" data-testid="notification-kinds">
              {PUSH_TYPES.map((type) => (
                <div key={type} className="py-1">
                  <Toggle label={c.kinds[type]} checked={!muted.includes(type)} onChange={(wanted) => void setKind(type, wanted)} />
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>
    </StepPage>
  )
}
