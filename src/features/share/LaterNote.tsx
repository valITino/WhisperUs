// What is shown, wished or answered on the list travels through the room's cloud. A
// cloud that has not been updated for it yet keeps none of that: it waits on the phone.
// Wherever the other one would be expected to see something, this note says so, so that
// nobody wonders why nothing arrives. It shows only while something is waiting.

import { navigate } from '../../app/router'
import { useSyncStatus } from '../../data/app'
import { useCopy } from '../../i18n'
import { WarningNote } from '../onboarding/parts'

const copy = {
  en: {
    note: (n: number) => `${n === 1 ? '1 thing is' : `${n} things are`} saved on this phone and cannot reach your partner yet: the room's cloud needs an update first. Nothing is lost, and it goes out by itself afterwards.`,
    more: 'What is waiting',
  },
  de: {
    note: (n: number) => `${n === 1 ? '1 Sache ist' : `${n} Sachen sind`} auf diesem Handy gespeichert und ${n === 1 ? 'kann' : 'können'} deinen Schatz noch nicht erreichen: Die Cloud des Zimmers braucht zuerst ein Update. Nichts geht verloren, danach geht es von selbst raus.`,
    more: 'Was wartet',
  },
}

export function LaterNote() {
  const c = useCopy(copy)
  const { later } = useSyncStatus()
  if (later === 0) return null
  return (
    <div className="flex flex-col items-start gap-1" data-testid="later-note">
      <WarningNote>{c.note(later)}</WarningNote>
      <button type="button" className="min-h-11 px-1 text-xs font-extrabold text-accent underline underline-offset-2" onClick={() => navigate('/settings/sync')}>
        {c.more}
      </button>
    </div>
  )
}
