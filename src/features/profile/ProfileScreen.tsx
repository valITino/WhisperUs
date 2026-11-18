// A profile to look at. Two pages, one drawing:
//
//   /profile           mine: what the other one sees of me, and the ways to change it
//   /profile/partner   the other one's: what they chose to show me
//
// Both read the rows that travel and nothing else (src/data/profile.ts), so my own page
// is, part by part, the page the other one sees. Changing the profile itself (name,
// picture, status line) stays at /settings/profile.

import { useEffect, type ReactNode } from 'react'
import { navigate } from '../../app/router'
import { useMe } from '../../data/hooks'
import { markAboutSeen, useAbout, useList, useNewAnswers, useProfile, useWishes, type Profile } from '../../data/queries'
import type { Common } from '../../data/profile'
import { useCopy, useLang, useT } from '../../i18n'
import { dayAndTime } from '../../lib/when'
import { Avatar, Button, Card, EmptyState, HeatMeter, Loader, Tag } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { QUESTIONS } from '../about/library'
import { checkinCopy } from '../checkin/copy'
import { CheckinView } from '../checkin/CheckinView'
import { cockpitCopy } from '../cockpit/copy'
import { homeCopy } from '../home/copy'
import { EnvelopeRow } from '../home/EnvelopeRow'
import { listCopy } from '../list/copy'
import { itemWords } from '../list/library'
import { StepPage } from '../onboarding/parts'
import { stepBetween } from '../share/steps'
import { WhyView } from '../why'
import { wishesCopy } from '../wishes/copy'
import { WishRow } from '../wishes/WishRow'
import { viewCopy } from './viewCopy'

/** How many rows of a kind a profile lists before it points to the page that has them all. */
const ROWS = 4

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`profile-${id}`} data-testid={`profile-${id}`}>
      <h2 id={`profile-${id}`} className="mb-2.5 px-1 text-lg">
        {title}
      </h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}

/** A row that leads somewhere else. */
function LinkRow({ title, hint, to, testId }: { title: string; hint?: string; to: string; testId?: string }) {
  return (
    <button type="button" data-testid={testId} onClick={() => navigate(to)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{hint}</span>}
      </span>
      <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
    </button>
  )
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="px-1 text-sm text-ink-soft">{children}</p>

export function ProfileScreen({ side }: { side: 'mine' | 'theirs' }) {
  const c = useCopy(viewCopy)
  const me = useMe()
  const profile = useProfile(side)
  const list = useList()
  const about = useAbout()
  const wishes = useWishes()
  const newAnswers = useNewAnswers()

  // Looking at the other one's profile is looking at what they showed about themselves.
  // What is new stays marked while the page is open, and counts as seen once it was shown.
  const freshKey = profile ? [...profile.freshAbout].join(',') : ''
  useEffect(() => {
    if (!freshKey) return
    return () => void markAboutSeen()
  }, [freshKey])

  const back = side === 'mine' ? '/' : '/settings'
  if (profile === undefined || !list || !about || !wishes || !newAnswers) {
    return (
      <StepPage title={side === 'mine' ? c.mineTitle : c.theirsTitle} backTo={back}>
        <Loader />
      </StepPage>
    )
  }
  if (!profile) {
    // The other one's profile while the second seat is still empty.
    return (
      <StepPage title={c.nobody.title} backTo={back}>
        <EmptyState
          lit={false}
          title={c.nobody.title}
          body={c.nobody.body}
          action={
            me?.member?.isAdmin ? (
              <Button variant="secondary" onClick={() => navigate('/settings/invite')}>
                {c.nobody.invite}
              </Button>
            ) : undefined
          }
        />
      </StepPage>
    )
  }

  return (
    <StepPage title={profile.mine ? c.mineTitle : c.theirsTitle} backTo={back}>
      <div className="flex flex-col gap-8 px-4" data-testid={profile.mine ? 'profile-mine' : 'profile-theirs'}>
        <Head profile={profile} />
        <Sections profile={profile} list={list} answered={about.mine.size} fresh={{ wishes: profile.mine ? wishes.freshAnswers : wishes.unopened, answers: newAnswers }} />
      </div>
    </StepPage>
  )
}

function Head({ profile }: { profile: Profile }) {
  const c = useCopy(viewCopy)
  const { who, other, mine } = profile
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar avatar={who.avatar} color={who.color} accessory={who.accessory} size={96} />
      <div className="min-w-0 max-w-full">
        <p className="break-words font-display text-xl font-semibold leading-tight" data-testid="profile-name">
          {who.name}
        </p>
        {who.status ? (
          <p className="mt-2 inline-block max-w-full break-words rounded-[18px] border border-line bg-surface px-4 py-2 text-sm font-bold leading-snug" data-testid="profile-status">
            {who.status}
          </p>
        ) : (
          mine && <p className="mt-1.5 text-sm text-ink-soft">{c.noStatus}</p>
        )}
      </div>
      {mine && (
        <Button variant="secondary" icon={<Icon name="pen" size={18} />} onClick={() => navigate('/settings/profile')}>
          {c.edit}
        </Button>
      )}
      <p className="max-w-[22rem] text-sm leading-snug text-ink-soft" data-testid="profile-lead">
        {mine ? (other ? c.lead.mine(other.name) : c.lead.mineAlone) : c.lead.theirs(who.name)}
      </p>
    </div>
  )
}

interface SectionsProps {
  profile: Profile
  list: NonNullable<ReturnType<typeof useList>>
  /** How many of the questions about myself I answered (my own page). */
  answered: number
  fresh: { wishes: ReadonlySet<string>; answers: ReadonlySet<string> }
}

function Sections({ profile, list, answered, fresh }: SectionsProps) {
  const c = useCopy(viewCopy)
  const cc = useCopy(checkinCopy)
  const lc = useCopy(listCopy)
  const wc = useCopy(wishesCopy)
  const hc = useCopy(homeCopy)
  const kc = useCopy(cockpitCopy)
  const lang = useLang()
  const t = useT()
  const { who, other, mine, shown, envelopes } = profile
  // "You" for whoever holds the phone, the name for the other one.
  const whoLabel = mine ? c.you : who.name
  const otherLabel = mine ? (other?.name ?? '') : c.you
  const answers = QUESTIONS.flatMap((question) => {
    const answer = shown.about.get(question.id)
    return answer ? [{ question, answer }] : []
  })
  const common = shown.common.map((row) => ({ row, label: itemWords(row.item, lang, list.ideas) })).filter((entry): entry is { row: Common; label: string } => entry.label !== null)
  // The one whose phone this is not: rows about envelopes and wishes speak of "them".
  const them = mine ? other : who

  return (
    <>
      <Section id="checkin" title={mine ? c.sections.checkin.mine : c.sections.checkin.theirs(who.name)}>
        {shown.checkin ? (
          <Card tone="note" pad={false} className="p-5" data-testid="profile-checkin-shown">
            <p className="mb-3 text-xs font-semibold text-ink-soft">{dayAndTime(shown.checkin.at, lang, t.common)}</p>
            <CheckinView body={shown.checkin.body} ideas={list.ideas} />
          </Card>
        ) : (
          <Quiet>{mine ? c.none.checkin.mine : c.none.checkin.theirs(who.name)}</Quiet>
        )}
        {mine && (
          <Card pad={false} className="overflow-hidden">
            <LinkRow title={cc.home.action} hint={c.actions.checkinHint} to="/checkin" testId="profile-to-checkin" />
          </Card>
        )}
      </Section>

      <Section id="about" title={mine ? c.sections.about.mine : c.sections.about.theirs(who.name)}>
        {answers.length > 0 ? (
          <ul className="flex flex-col gap-2.5" data-testid="profile-about-list">
            {answers.map(({ question, answer }) => {
              const words = question[lang]
              return (
                <li key={question.id}>
                  <Card tone="haze" pad={false} className="flex flex-col gap-2 p-4">
                    <p className="flex items-start justify-between gap-3">
                      <span className="text-sm font-bold leading-snug">{words.ask}</span>
                      {profile.freshAbout.has(question.id) && <Tag tone="wax">{c.newTag}</Tag>}
                    </p>
                    {answer.body.value && <p className="text-sm font-semibold text-accent">{stepBetween(words.low, words.high, answer.body.value, lang)}</p>}
                    {answer.body.why && <WhyView why={answer.body.why} />}
                  </Card>
                </li>
              )
            })}
          </ul>
        ) : (
          <Quiet>{mine ? c.none.about.mine : c.none.about.theirs(who.name)}</Quiet>
        )}
        {mine && (
          <Card pad={false} className="overflow-hidden">
            <LinkRow title={c.actions.about} hint={c.actions.aboutHint(answered, QUESTIONS.length, shown.about.size)} to="/about" testId="profile-to-about" />
          </Card>
        )}
      </Section>

      <Section id="common" title={c.sections.common}>
        {common.length > 0 ? (
          <ul className="flex flex-col gap-2" data-testid="profile-common-list">
            {common.slice(0, ROWS).map(({ row, label }) => (
              <li key={row.item} className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold leading-snug">{label}</span>
                    <span className="mt-0.5 block text-xs font-semibold leading-snug">{c.says(whoLabel, lc.lean[row.lean])}</span>
                    {otherLabel && <span className="block text-xs leading-snug text-ink-soft">{c.says(otherLabel, lc.lean[row.otherLean])}</span>}
                  </span>
                  {row.pull !== null && <HeatMeter label={mine ? c.yourPull : lc.theirPull(who.name)} value={row.pull} size={16} />}
                </div>
                {row.why && <WhyView why={row.why} />}
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>{c.none.common}</Quiet>
        )}
        {common.length > ROWS && <Quiet>{c.andMore(common.length - ROWS)}</Quiet>}
        <Card pad={false} className="overflow-hidden">
          <LinkRow title={c.actions.list} hint={mine ? kc.links.listHint(list.mine.size, list.matches.length) : undefined} to="/list" testId="profile-to-list" />
        </Card>
      </Section>

      <Section id="wishes" title={mine ? c.sections.wishes.mine : c.sections.wishes.theirs(who.name)}>
        {shown.wishes.length > 0 && them ? (
          <ul className="flex flex-col gap-2.5" data-testid="profile-wishes-list">
            {shown.wishes.slice(0, ROWS).map((wish) => (
              <WishRow key={wish.id} wish={wish} mine={mine} partner={them} fresh={fresh.wishes.has(wish.id)} />
            ))}
          </ul>
        ) : (
          <Quiet>{mine ? wc.noneFromMe : wc.noneForMe(who.name)}</Quiet>
        )}
        {shown.wishes.length > ROWS && <Quiet>{c.andMore(shown.wishes.length - ROWS)}</Quiet>}
        {(shown.wishes.length > 0 || (mine && other)) && (
          <Card pad={false} className="overflow-hidden">
            {shown.wishes.length > 0 ? <LinkRow title={c.actions.allWishes} to="/wishes" testId="profile-to-wishes" /> : <LinkRow title={wc.make} to="/wishes/new" testId="profile-to-wish" />}
          </Card>
        )}
      </Section>

      <Section id="envelopes" title={mine ? c.sections.envelopes.mine : c.sections.envelopes.theirs(who.name)}>
        {envelopes.length > 0 && them ? (
          <ul className="flex flex-col gap-2.5" data-testid="profile-envelopes-list">
            {envelopes.slice(0, ROWS).map((view) => (
              <EnvelopeRow key={view.envelope.id} view={view} partner={them} fresh={mine && fresh.answers.has(view.envelope.id)} />
            ))}
          </ul>
        ) : (
          <Quiet>{mine ? hc.noneFromMe : hc.noneForMe(who.name)}</Quiet>
        )}
        {envelopes.length > ROWS && <Quiet>{c.andMore(envelopes.length - ROWS)}</Quiet>}
        {envelopes.length > 0 && (
          <Card pad={false} className="overflow-hidden">
            <LinkRow title={c.actions.allEnvelopes} to="/" testId="profile-to-room" />
          </Card>
        )}
      </Section>

      <Section id="more" title={c.sections.more}>
        <Card pad={false} className="divide-y divide-line overflow-hidden">
          {mine && <LinkRow title={c.actions.cockpitMine} hint={c.actions.cockpitMineHint} to="/cockpit" />}
          {mine && <LinkRow title={cc.times.row} to="/settings/checkin" />}
          {other && <LinkRow title={c.actions.cockpitOurs} hint={c.actions.cockpitOursHint} to="/cockpit/us" />}
        </Card>
      </Section>
    </>
  )
}
