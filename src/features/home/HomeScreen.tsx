// The room: who is here, what waits for me, and what I sealed. The first of the two tabs.

import { navigate } from '../../app/router'
import { useSyncStatus } from '../../data/app'
import { updateMyPrefs } from '../../data/do'
import type { EnvelopeView } from '../../data/envelopes'
import { parseSlot, slotRef } from '../../data/journal'
import { useCheckins, useEnvelopes, useNewAnswers, useRoom, useSlot } from '../../data/queries'
import { CHECKIN_SCALES, nowIso, type Member } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { formatTime, zurichHour } from '../../lib/dates'
import { inWords } from '../../lib/when'
import { Avatar, Button, Card, cx, EmptyState, Loader, Screen, SyncPill, Tag, toast } from '../../ui/components'
import { Candle, Envelope } from '../../ui/deco/Deco'
import { Icon } from '../../ui/deco/Icon'
import { checkinCopy } from '../checkin/copy'
import { SCALES } from '../checkin/library'
import { stepWords } from '../checkin/words'
import { helloCopy } from '../hello/copy'
import { ProfileBubble } from '../profile/ProfileBubble'
import { homeCopy } from './copy'

function greetingKey(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  return hour < 18 ? 'day' : 'evening'
}

function EnvelopeRow({ view, partner, fresh }: { view: EnvelopeView; partner: Member; fresh: boolean }) {
  const c = useCopy(homeCopy).card
  const lang = useLang()
  const { envelope, standing } = view
  const when = view.nextOpening ? inWords(view.nextOpening, lang) : null

  let line: string
  if (standing === 'ready') line = view.layers.some((l) => l.seenAt) ? c.readyMore : c.ready
  else if (standing === 'waiting') line = when ? c.waitingAt(when) : c.waitingHand(partner.name)
  else if (standing === 'opened') line = view.answered ? c.openedAnswered : c.opened
  else if (view.answered) line = c.answered(partner.name)
  else if (standing === 'out') line = c.out(partner.name)
  else line = when ? c.sealedAt(when) : c.sealedHand

  const asks = standing === 'ready' || fresh
  const title = envelope.teaser?.trim()
  const open = standing === 'opened' || standing === 'out'

  return (
    <li>
      <button
        type="button"
        data-testid="envelope-row"
        data-standing={standing}
        aria-label={c.open(`${title ?? c.plain}. ${line}`)}
        onClick={() => navigate(`/envelope/${envelope.id}`)}
        className={cx('flex w-full items-center gap-3.5 rounded-card border bg-surface p-3 text-left active:translate-y-[2px]', asks ? 'border-accent' : 'border-line')}
      >
        <Envelope size={54} state={open ? 'open' : 'sealed'} className="shrink-0 drop-shadow-[0_3px_5px_#2c1b3333]" />
        <span className="min-w-0 flex-1">
          {title ? <span className="handwritten block truncate text-[1.3rem] leading-tight text-accent">{title}</span> : <span className="block truncate text-sm font-semibold text-ink-soft">{c.plain}</span>}
          <span className={cx('mt-0.5 block text-xs leading-snug', asks ? 'font-bold text-ink' : 'font-semibold text-ink-soft')}>{line}</span>
        </span>
        {fresh && <Tag tone="wax">{c.newAnswer}</Tag>}
        <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
      </button>
    </li>
  )
}

export function HomeScreen() {
  const c = useCopy(homeCopy)
  const cc = useCopy(checkinCopy).home
  const hc = useCopy(helloCopy).card
  const lang = useLang()
  const room = useRoom()
  const envelopes = useEnvelopes()
  const newAnswers = useNewAnswers()
  const status = useSyncStatus()
  const slot = useSlot()
  const checkins = useCheckins()

  if (!room || !envelopes || !checkins) {
    return (
      <Screen tabs className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }

  const { me, partner } = room
  const { forMe, fromMe } = envelopes
  const nothing = forMe.length === 0 && fromMe.length === 0
  // The pill only speaks up when there is something to know.
  const quiet = (status.state === 'idle' || status.state === 'syncing') && status.pending + status.uploads === 0 && status.stuck === 0
  // My check-in of this half of the day, if I made one.
  const mine = checkins.mine.find((entry) => entry.ref === slotRef(slot))
  // What the other one chose to show of today: the evening before the morning.
  const shown = checkins.theirs.filter((entry) => parseSlot(entry.ref)?.day === slot.day)
  const theirs = shown.find((entry) => entry.ref.endsWith('.pm')) ?? shown[0]
  const theirScales = theirs ? CHECKIN_SCALES.filter((scale) => theirs.body[scale] !== undefined) : []

  return (
    <Screen tabs>
      <header className="app-column px-5 pb-2 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl">{c.greeting[greetingKey(zurichHour())](me.name)}</h1>
          <button type="button" aria-label={me.name} onClick={() => navigate('/settings/profile')} className="shrink-0 rounded-full">
            <Avatar avatar={me.avatar} color={me.color} accessory={me.accessory} size={44} />
          </button>
        </div>
        {!quiet && (
          <div className="mt-3">
            <SyncPill status={status} />
          </div>
        )}
      </header>

      <main className="app-column flex flex-col gap-7 px-4 pt-3" data-testid="home">
        {partner ? (
          partner.status && <ProfileBubble name={partner.name} status={partner.status} placeholder="" avatar={partner.avatar} color={partner.color} accessory={partner.accessory} />
        ) : (
          <Card pad={false} className="flex items-center gap-3 p-4" data-testid="home-alone">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">{c.alone.title}</h2>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{me.isAdmin ? c.alone.bodyAdmin : c.alone.body}</p>
              {me.isAdmin && (
                <Button className="mt-3" onClick={() => navigate('/settings/invite')}>
                  {c.alone.invite}
                </Button>
              )}
            </div>
            <Candle size={72} lit={false} className="shrink-0" />
          </Card>
        )}

        {partner && theirs && theirScales.length > 0 && (
          <Card tone="note" pad={false} className="p-5" data-testid="their-day">
            <h2 className="text-lg">{cc.theirs(partner.name)}</h2>
            <p className="mt-0.5 text-xs font-semibold text-ink-soft">{theirs.ref.endsWith('.pm') ? cc.evening : cc.morning}</p>
            <dl className="mt-3 flex flex-col gap-1.5">
              {theirScales.map((scale) => (
                <div key={scale} className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <dt className="text-sm font-semibold text-ink-soft">{SCALES[scale][lang].short}</dt>
                  <dd className="text-sm font-bold">{stepWords(scale, theirs.body[scale] as number, lang)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {mine ? (
          <div className="-my-2 flex items-center justify-between gap-3 px-1" data-testid="checkin-done">
            <p className="text-sm font-semibold text-ink-soft">{cc.done(formatTime(mine.at, lang))}</p>
            <Button variant="quiet" onClick={() => navigate('/checkin')}>
              {cc.change}
            </Button>
          </div>
        ) : (
          <Card pad={false} className="flex items-center gap-3 p-4" data-testid="checkin-card">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg">{cc.ask}</h2>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{cc.askBody}</p>
              <Button variant="secondary" className="mt-3" onClick={() => navigate('/checkin')}>
                {cc.action}
              </Button>
            </div>
          </Card>
        )}

        {!me.prefs.firstLook && (
          <Card tone="haze" pad={false} className="p-4" data-testid="hello-card">
            <h2 className="text-lg">{hc.title}</h2>
            <p className="mt-1 text-sm leading-snug">{hc.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Button variant="secondary" onClick={() => navigate('/hello')}>
                {hc.action}
              </Button>
              {/* An offer, not a nudge: it can be declined, and then it is gone. */}
              <Button
                variant="quiet"
                onClick={() => {
                  void updateMyPrefs({ firstLook: nowIso() })
                  toast(hc.declined)
                }}
              >
                {hc.decline}
              </Button>
            </div>
          </Card>
        )}

        {partner && nothing && (
          <EmptyState
            title={c.empty.title}
            body={c.empty.body}
            action={
              <Button size="lg" onClick={() => navigate('/booth')}>
                {c.empty.action}
              </Button>
            }
          />
        )}

        {partner && !nothing && (
          <>
            <section aria-labelledby="for-me">
              <h2 id="for-me" className="mb-2.5 px-1 text-lg">
                {c.forMe}
              </h2>
              {forMe.length > 0 ? (
                <ul className="flex flex-col gap-2.5" data-testid="for-me">
                  {forMe.map((view) => (
                    <EnvelopeRow key={view.envelope.id} view={view} partner={partner} fresh={false} />
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-sm text-ink-soft">{c.noneForMe(partner.name)}</p>
              )}
            </section>

            <section aria-labelledby="from-me">
              <h2 id="from-me" className="mb-2.5 px-1 text-lg">
                {c.fromMe}
              </h2>
              {fromMe.length > 0 ? (
                <ul className="flex flex-col gap-2.5" data-testid="from-me">
                  {fromMe.map((view) => (
                    <EnvelopeRow key={view.envelope.id} view={view} partner={partner} fresh={newAnswers?.has(view.envelope.id) ?? false} />
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-sm text-ink-soft">{c.noneFromMe}</p>
              )}
            </section>
          </>
        )}
      </main>
    </Screen>
  )
}
