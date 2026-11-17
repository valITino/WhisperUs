// "Check-in" in Settings: the two moments of the day, and whether a notification reminds
// me of them. It lives on the profile, so it follows me to every device. Off until I say so.

import { useState } from 'react'
import { back, navigate } from '../../app/router'
import { updateMyPrefs } from '../../data/do'
import { useMe } from '../../data/hooks'
import { DEFAULT_CHECKIN_TIMES, type CheckinTimes } from '../../data/types'
import { useCopy } from '../../i18n'
import { usePush } from '../../pwa/notifications'
import { Button, Card, Field, Loader, toast, Toggle } from '../../ui/components'
import { StepPage, WarningNote } from '../onboarding/parts'
import { checkinCopy } from './copy'

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** What a profile says about its check-in times, or the defaults when it says nothing sensible. */
export function checkinTimes(prefs: { checkin?: CheckinTimes } | undefined): CheckinTimes {
  const saved = prefs?.checkin
  if (!saved || !Array.isArray(saved.times) || saved.times.length !== 2 || !saved.times.every((time) => CLOCK.test(time))) return DEFAULT_CHECKIN_TIMES
  return { remind: saved.remind === true, times: [saved.times[0], saved.times[1]] }
}

export function TimesFields({ value, onChange }: { value: CheckinTimes; onChange: (next: CheckinTimes) => void }) {
  const c = useCopy(checkinCopy).times
  const { status } = usePush()
  const setTime = (index: 0 | 1, time: string) => {
    if (!CLOCK.test(time)) return
    const times: [string, string] = [value.times[0], value.times[1]]
    times[index] = time
    onChange({ ...value, times })
  }
  return (
    <div className="flex flex-col gap-4" data-testid="checkin-times">
      <div className="grid grid-cols-2 gap-3">
        <Field label={c.first} type="time" value={value.times[0]} onChange={(e) => setTime(0, e.target.value)} />
        <Field label={c.second} type="time" value={value.times[1]} onChange={(e) => setTime(1, e.target.value)} />
      </div>
      <p className="-mt-2 text-xs text-ink-soft">{c.zone}</p>
      <Card pad={false} className="px-4 py-1">
        <Toggle label={c.remind} checked={value.remind} onChange={(remind) => onChange({ ...value, remind })} />
        <p className="pb-3 text-xs leading-snug text-ink-soft">{c.remindHint}</p>
      </Card>
      {value.remind && status !== 'on' && (
        <div className="flex flex-col gap-2">
          <WarningNote>{c.needsPush}</WarningNote>
          <Button variant="secondary" onClick={() => navigate('/settings/notifications')}>
            {c.openPush}
          </Button>
        </div>
      )}
    </div>
  )
}

export function TimesPage() {
  const c = useCopy(checkinCopy).times
  const me = useMe()
  const member = me?.member
  if (!member) {
    return (
      <StepPage title={c.title} backTo="/settings">
        <Loader />
      </StepPage>
    )
  }
  return <TimesForm key={member.id} initial={checkinTimes(member.prefs)} />
}

function TimesForm({ initial }: { initial: CheckinTimes }) {
  const c = useCopy(checkinCopy).times
  const [value, setValue] = useState(initial)
  const save = async () => {
    await updateMyPrefs({ checkin: value })
    toast(c.saved)
    back('/settings')
  }
  return (
    <StepPage
      title={c.title}
      backTo="/settings"
      footer={
        <Button size="lg" block onClick={() => void save()}>
          {c.save}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 px-4">
        <p className="text-sm text-ink-soft">{c.lead}</p>
        <TimesFields value={value} onChange={setValue} />
      </div>
    </StepPage>
  )
}
