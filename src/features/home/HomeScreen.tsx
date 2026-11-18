// The room: who is here, what is new, how I am, what waits for me, and what I sealed. The
// first of the tabs, and the page the app opens on.

import { navigate } from '../../app/router'
import { useSyncStatus } from '../../data/app'
import { updateMyPrefs } from '../../data/do'
import { parseSlot, slotRef } from '../../data/journal'
import { useCheckins, useEnvelopes, useNewAnswers, useNews, useRoom, useSlot } from '../../data/queries'
import { CHECKIN_SCALES, nowIso } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { formatTime, zurichHour } from '../../lib/dates'
import { dayAndTime } from '../../lib/when'
import { Avatar, Button, Card, EmptyState, Loader, Screen, SyncPill, toast } from '../../ui/components'
import { Candle } from '../../ui/deco/Deco'
import { Icon } from '../../ui/deco/Icon'
import { checkinCopy } from '../checkin/copy'
import { SCALES } from '../checkin/library'
import { stepWords } from '../checkin/words'
import { helloCopy } from '../hello/copy'
import { newsCopy } from '../news/copy'
import { NewsBell, NewsList } from '../news/NewsList'
import { homeCopy } from './copy'
import { EnvelopeRow } from './EnvelopeRow'

/** How many new things the room itself lists before it points to the news. */
const NEWS_HERE = 3

function greetingKey(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour < 5) return 'night'
  if (hour < 11) return 'morning'
  return hour < 18 ? 'day' : 'evening'
}

export function HomeScreen() {
  const c = useCopy(homeCopy)
  const cc = useCopy(checkinCopy).home
  const hc = useCopy(helloCopy).card
  const nc = useCopy(newsCopy)
  const lang = useLang()
  const t = useT()
  const room = useRoom()
  const envelopes = useEnvelopes()
  const newAnswers = useNewAnswers()
  const status = useSyncStatus()
  const slot = useSlot()
  const checkins = useCheckins()
  const news = useNews()

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
  const fresh = news?.items.filter((item) => item.fresh) ?? []

  return (
    <Screen tabs>
      <header className="app-column px-5 pb-2 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-2xl">{c.greeting[greetingKey(zurichHour())](me.name)}</h1>
          <div className="flex shrink-0 items-center gap-3">
            <NewsBell count={news?.fresh ?? 0} />
            <button type="button" data-testid="my-avatar" aria-label={c.myProfile} onClick={() => navigate('/profile')} className="shrink-0 rounded-full">
              <Avatar avatar={me.avatar} color={me.color} accessory={me.accessory} size={44} />
            </button>
          </div>
        </div>
        {!quiet && (
          <div className="mt-3">
            <SyncPill status={status} />
          </div>
        )}
      </header>

      <main className="app-column flex flex-col gap-7 px-4 pt-3" data-testid="home">
        {partner ? (
          // The other one: who they are, and what they showed of today. A tap opens their profile.
          <Card pad={false} className="overflow-hidden" data-testid="partner-strip">
            <button type="button" data-testid="partner-row" onClick={() => navigate('/profile/partner')} className="flex w-full items-center gap-3.5 p-3.5 text-left active:bg-haze/40">
              <Avatar avatar={partner.avatar} color={partner.color} accessory={partner.accessory} size={52} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-lg font-semibold leading-tight">{partner.name}</span>
                {partner.status && <span className="mt-0.5 block break-words text-sm font-bold leading-snug">{partner.status}</span>}
              </span>
              {/* Read aloud after the name and status, so what is seen is also what is said. */}
              <span className="sr-only">{c.openProfile}</span>
              <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
            </button>
            {theirs && theirScales.length > 0 && (
              <div className="border-t border-line bg-haze/60 px-4 pb-4 pt-3.5" data-testid="their-day">
                <h2 className="text-base">{cc.theirs(partner.name)}</h2>
                <p className="mt-0.5 text-xs font-semibold text-ink-soft">{dayAndTime(theirs.at, lang, t.common)}</p>
                <dl className="mt-2.5 flex flex-col gap-1.5">
                  {theirScales.map((scale) => (
                    <div key={scale} className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-sm font-semibold text-ink-soft">{SCALES[scale][lang].short}</dt>
                      <dd className="text-sm font-bold">{stepWords(scale, theirs.body[scale] as number, lang)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>
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

        {fresh.length > 0 && (
          // What is new, wherever in the app it is. The bell has all of it.
          <section aria-labelledby="home-news" data-testid="home-news">
            <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
              <h2 id="home-news" className="text-lg">
                {nc.fresh}
              </h2>
              <Button variant="quiet" className="-mr-3" onClick={() => navigate('/news')}>
                {nc.all}
              </Button>
            </div>
            <NewsList items={fresh.slice(0, NEWS_HERE)} partner={partner?.name ?? null} />
          </section>
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
