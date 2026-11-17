// The cockpit: what was noted, looked at over days and weeks. Two pages.
//
//   Mine   everything I noted, as far as this phone has it. Only I see it.
//   Ours   only what each of us chose to show. Both phones draw the same page.
//
// It is a notebook, not a dashboard: thin ink columns on a hairline, a few sentences,
// no totals to reach. A day without a check-in is simply not there. (DECISIONS.md, 12.)

import { useState, type ReactNode } from 'react'
import { navigate } from '../../app/router'
import { ENOUGH, fantasyDays, fold, goesWith, halfTendency, happenedDays, highDays, howMany, lastDays, reasonDays, series, thoughtDays, thoughtsSeries, weekdayTendency, type Entry } from '../../data/cockpit'
import { useAbout, useCheckins, useList, useRoom, useWishes } from '../../data/queries'
import { CHECKIN_SCALES, type CheckinScale, type Member, type Often } from '../../data/types'
import { useCopy, useLang, type Lang } from '../../i18n'
import { addDays, formatDay, today, type Day } from '../../lib/dates'
import { Avatar, Button, Card, DayColumns, EmptyState, Loader, RankedBars, Screen, Segmented } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { QUESTIONS } from '../about/library'
import { happenedWords, oftenWords, SCALES } from '../checkin/library'
import { stepWords } from '../checkin/words'
import { itemWords } from '../list/library'
import { stepBetween } from '../share/steps'
import { reasonWords } from '../why'
import { cockpitCopy, type CockpitCopy } from './copy'

type Period = 'week' | 'month' | 'quarter'
/** The long view is thirteen whole weeks, folded week by week. */
const DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 91 }

interface Frame {
  period: Period
  days: Day[]
  /** The first day of each column: a day, or the Monday-like start of a week of the long view. */
  starts: Day[]
  weekly: boolean
}

function frameOf(period: Period): Frame {
  const days = lastDays(today(), DAYS[period])
  const weekly = period === 'quarter'
  return { period, days, weekly, starts: weekly ? days.filter((_, i) => i % 7 === 0) : days }
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`cockpit-${id}`} data-testid={`cockpit-${id}`}>
      <h2 id={`cockpit-${id}`} className="mb-2.5 px-1 text-lg">
        {title}
      </h2>
      <Card pad={false} className="flex flex-col gap-5 p-4">
        {children}
      </Card>
    </section>
  )
}

interface RowProps {
  c: CockpitCopy
  lang: Lang
  frame: Frame
  entries: readonly Entry[]
  /** A scale of the check-in, or "thoughts" (how often sex was on the mind). */
  what: CheckinScale | 'thoughts'
  /** Whose row it is on the page for two; nobody on my own page. */
  who?: Member
  /** No title above: the row is one of several under a shared title. */
  bare?: boolean
}

/** One thing over the days: its name, thin columns on a hairline, and words for the column that is tapped. */
function ScaleRow({ c, lang, frame, entries, what, who, bare = false }: RowProps) {
  const daily = what === 'thoughts' ? thoughtsSeries(entries, frame.days) : series(entries, what, frame.days)
  const values = frame.weekly ? fold(daily, 7) : daily
  const name = what === 'thoughts' ? c.thoughts : SCALES[what][lang].short
  const inWords = (value: number) => (what === 'thoughts' ? oftenWords(Math.round(value) as Often, lang) : stepWords(what, value, lang))
  const date = (index: number) => formatDay(frame.starts[index], lang, frame.weekly ? 'date-short' : 'full')
  const words = what === 'thoughts' ? null : SCALES[what][lang]
  return (
    <div data-testid={`row-${what}${who ? `-${who.id}` : ''}`}>
      {!bare && (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h3 className="font-sans text-sm font-bold tracking-normal">{name}</h3>
          {words && <span className="text-right text-2xs font-semibold text-ink-soft">{`${words.low} / ${words.high}`}</span>}
        </div>
      )}
      <DayColumns
        label={c.chartLabel(name, who ? who.name : null, c.periods[frame.period])}
        values={values}
        max={what === 'thoughts' ? 4 : 5}
        zeroIsAnswer={what === 'thoughts'}
        describe={(index, value) => (frame.weekly ? c.week : c.day)(date(index), inWords(value))}
        emptyWords={(index) => (frame.weekly ? c.nothingWeek : c.nothingDay)(date(index))}
        from={formatDay(frame.starts[0], lang, 'date-short')}
        to={c.today}
        lead={who ? <Avatar avatar={who.avatar} color={who.color} accessory={who.accessory} size={28} name={who.name} /> : undefined}
      />
    </div>
  )
}

const said = (entries: readonly Entry[], what: CheckinScale | 'thoughts', days: readonly Day[]) => (what === 'thoughts' ? thoughtsSeries(entries, days) : series(entries, what, days)).some((v) => v !== null)

function LinkRow({ title, hint, to }: { title: string; hint?: string; to: string }) {
  return (
    <button type="button" onClick={() => navigate(to)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{hint}</span>}
      </span>
      <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
    </button>
  )
}

/** A few reasons as quiet chips, after a lead-in. */
function Reasons({ lead, ids, lang }: { lead: string; ids: readonly string[]; lang: Lang }) {
  if (ids.length === 0) return null
  return (
    <div>
      <p className="mb-1.5 text-sm">{lead}</p>
      <ul className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <li key={id} className="inline-flex items-center rounded-full border-[1.5px] border-line-strong px-3 py-1.5 text-xs font-bold leading-tight">
            {reasonWords(id, lang)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CockpitScreen({ view }: { view: 'mine' | 'ours' }) {
  const c = useCopy(cockpitCopy)
  const lang = useLang()
  const room = useRoom()
  const checkins = useCheckins()
  const list = useList()
  const about = useAbout()
  const wishes = useWishes()
  const [period, setPeriod] = useState<Period>('month')

  if (!room || !checkins || !list || !about || !wishes) {
    return (
      <Screen tabs className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }
  const frame = frameOf(period)
  const { me, partner } = room

  return (
    <Screen tabs>
      <header className="app-column px-5 pb-1 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl">{c.title}</h1>
      </header>
      <main className="app-column flex flex-col gap-7 px-4 pt-4" data-testid={`cockpit-${view}`}>
        {/* One row of choices above everything they scope. */}
        <div className="flex flex-col gap-2.5">
          <Segmented<'mine' | 'ours'>
            label={c.view}
            value={view}
            options={[
              { value: 'mine', label: c.mine },
              { value: 'ours', label: c.ours },
            ]}
            onChange={(next) => navigate(next === 'mine' ? '/cockpit' : '/cockpit/us', { replace: true })}
          />
          <Segmented<Period> label={c.period} value={period} options={(['week', 'month', 'quarter'] as const).map((value) => ({ value, label: c.periods[value] }))} onChange={setPeriod} />
        </div>

        {view === 'mine' ? (
          <Mine c={c} lang={lang} frame={frame} entries={checkins.mine} list={list} answered={about.mine.size} />
        ) : partner ? (
          <Ours c={c} lang={lang} frame={frame} me={me} partner={partner} mine={checkins.mineShown} theirs={checkins.theirs} list={list} about={about} wishes={wishes} />
        ) : (
          <p className="px-1 text-sm text-ink-soft">{c.oursAlone}</p>
        )}
      </main>
    </Screen>
  )
}

// ------------------------------------------------------------------- mine --

interface MineProps {
  c: CockpitCopy
  lang: Lang
  frame: Frame
  entries: readonly Entry[]
  list: NonNullable<ReturnType<typeof useList>>
  answered: number
}

function Mine({ c, lang, frame, entries, list, answered }: MineProps) {
  const count = howMany(entries, frame.days)
  const links = (
    <section aria-labelledby="cockpit-more" data-testid="cockpit-more">
      <h2 id="cockpit-more" className="mb-2.5 px-1 text-lg">
        {c.sections.more}
      </h2>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        <LinkRow title={c.links.about} hint={c.links.aboutHint(answered, QUESTIONS.length)} to="/about" />
        <LinkRow title={c.links.list} hint={c.links.listHint(list.mine.size, list.matches.length)} to="/list" />
        <LinkRow title={c.links.times} to="/settings/checkin" />
      </Card>
    </section>
  )

  if (entries.length === 0) {
    return (
      <>
        <EmptyState
          title={c.emptyMine.title}
          body={c.emptyMine.body}
          action={
            <Button size="lg" onClick={() => navigate('/checkin')}>
              {c.emptyMine.action}
            </Button>
          }
        />
        {links}
      </>
    )
  }

  const has = (what: CheckinScale | 'thoughts') => said(entries, what, frame.days)
  const mind = fantasyDays(entries, frame.days).map((row) => ({ ...row, name: itemWords(row.id, lang, list.ideas) })).filter((row): row is { id: string; days: number; name: string } => row.name !== null).slice(0, 6)
  const there = happenedDays(entries, frame.days)
  const behind = reasonDays(entries, frame.days).slice(0, 6)
  const thought = thoughtDays(entries, frame.days)
  const kinky = highDays(entries, 'kinky', frame.days)
  const half = halfTendency(entries, 'desire', frame.days)
  const weekday = weekdayTendency(entries, 'desire', frame.days)
  const companions = goesWith(entries, 'desire', frame.days)
  // The first of January 2024 was a Monday: a week of names without a calendar.
  const weekdayName = (index: number) => formatDay(addDays('2024-01-01', index), lang, 'weekday')
  const enough = count.entries >= ENOUGH

  return (
    <>
      <div className="px-1">
        <p className="text-sm text-ink-soft">{c.mineLead}</p>
        <p className="mt-2 text-sm font-bold" data-testid="cockpit-count">
          {c.howMany(count.entries, count.days)}
        </p>
      </div>

      {(has('energy') || has('mood')) && (
        <Section id="you" title={c.sections.you}>
          {(['energy', 'mood'] as const).filter(has).map((scale) => (
            <ScaleRow key={scale} c={c} lang={lang} frame={frame} entries={entries} what={scale} />
          ))}
        </Section>
      )}

      {(has('close') || has('open')) && (
        <Section id="us" title={c.sections.us}>
          {(['close', 'open'] as const).filter(has).map((scale) => (
            <ScaleRow key={scale} c={c} lang={lang} frame={frame} entries={entries} what={scale} />
          ))}
        </Section>
      )}

      {(has('desire') || has('kinky') || has('thoughts')) && (
        <Section id="desire" title={c.sections.desire}>
          {(['desire', 'kinky', 'thoughts'] as const).filter(has).map((what) => (
            <ScaleRow key={what} c={c} lang={lang} frame={frame} entries={entries} what={what} />
          ))}
          <div className="flex flex-col gap-1.5 text-sm" data-testid="cockpit-said">
            {thought.of > 0 && <p>{c.said.thoughtDays(thought.some, thought.of)}</p>}
            {kinky.high > 0 && <p>{c.said.kinkyDays(kinky.high)}</p>}
            {half && (
              <p>
                {c.said.desireHalf[half]} {weekday !== null && c.said.desireWeekday(weekdayName(weekday))}
              </p>
            )}
            {!half && weekday === null && !enough && <p className="text-ink-soft">{c.said.notEnough}</p>}
          </div>
        </Section>
      )}

      {(has('thoughts') || mind.length > 0) && (
        <Section id="mind" title={c.sections.mind}>
          {mind.length > 0 ? <RankedBars label={c.sections.mind} rows={mind.map((row) => ({ id: row.id, name: row.name, value: row.days, words: c.onDays(row.days) }))} /> : <p className="text-sm text-ink-soft">{c.fantasiesNone}</p>}
        </Section>
      )}

      {there.length > 0 && (
        <Section id="happened" title={c.sections.happened}>
          <RankedBars label={c.sections.happened} rows={there.map((row) => ({ id: row.id, name: happenedWords(row.id, lang), value: row.days, words: c.onDays(row.days) }))} />
        </Section>
      )}

      {behind.length > 0 && (
        <Section id="behind" title={c.sections.behind}>
          <RankedBars label={c.sections.behind} rows={behind.map((row) => ({ id: row.id, name: reasonWords(row.id, lang), value: row.days, words: c.onDays(row.days) }))} />
          <Reasons lead={c.said.withMore} ids={companions.high} lang={lang} />
          <Reasons lead={c.said.withLess} ids={companions.low} lang={lang} />
        </Section>
      )}

      {links}
    </>
  )
}

// ------------------------------------------------------------------- ours --

interface OursProps {
  c: CockpitCopy
  lang: Lang
  frame: Frame
  me: Member
  partner: Member
  mine: readonly Entry[]
  theirs: readonly Entry[]
  list: NonNullable<ReturnType<typeof useList>>
  about: NonNullable<ReturnType<typeof useAbout>>
  wishes: NonNullable<ReturnType<typeof useWishes>>
}

function Ours({ c, lang, frame, me, partner, mine, theirs, list, about, wishes }: OursProps) {
  // The same order on both phones, whoever is "me": by when each joined the room.
  const people = [
    { who: me, entries: mine },
    { who: partner, entries: theirs },
  ].sort((a, b) => a.who.createdAt.localeCompare(b.who.createdAt))
  const whats = [...CHECKIN_SCALES, 'thoughts' as const].filter((what) => people.some(({ entries }) => said(entries, what, frame.days)))
  const there = happenedDays([...mine, ...theirs], frame.days)
  // Questions both of us answered and showed, in the order they are asked.
  const both = QUESTIONS.filter((question) => {
    const shownByMe = about.mine.get(question.id)
    return shownByMe?.shared.includes('value') && shownByMe.body.value !== undefined && about.theirs.get(question.id)?.body.value !== undefined
  })
  const allWishes = [...wishes.forMe, ...wishes.fromMe]
  const nothing = whats.length === 0 && there.length === 0

  return (
    <>
      <p className="px-1 text-sm text-ink-soft">{c.oursLead(partner.name)}</p>

      {nothing && <EmptyState lit={false} title={c.emptyOurs.title} body={c.emptyOurs.body} />}

      {whats.map((what) => {
        const words = what === 'thoughts' ? null : SCALES[what][lang]
        return (
          <section key={what} aria-labelledby={`ours-${what}`} data-testid={`ours-${what}`}>
            <div className="mb-2.5 flex items-baseline justify-between gap-3 px-1">
              <h2 id={`ours-${what}`} className="text-lg">
                {what === 'thoughts' ? c.thoughtsShort : SCALES[what][lang].short}
              </h2>
              {words && <span className="text-right text-2xs font-semibold text-ink-soft">{`${words.low} / ${words.high}`}</span>}
            </div>
            <Card pad={false} className="flex flex-col gap-3 p-4">
              {people
                .filter(({ entries }) => said(entries, what, frame.days))
                .map(({ who, entries }) => (
                  <ScaleRow key={who.id} c={c} lang={lang} frame={frame} entries={entries} what={what} who={who} bare />
                ))}
            </Card>
          </section>
        )
      })}

      {there.length > 0 && (
        <Section id="happened" title={c.sections.happened}>
          <RankedBars label={c.sections.happened} rows={there.map((row) => ({ id: row.id, name: happenedWords(row.id, lang), value: row.days, words: c.onDays(row.days) }))} />
        </Section>
      )}

      <Section id="common" title={c.sections.common}>
        <p className="text-sm font-bold">{list.matches.length > 0 ? c.common.items(list.matches.length) : c.common.none}</p>
        {list.matches.length > 0 && (
          <ul className="-mt-2 flex flex-wrap gap-1.5">
            {list.matches.slice(0, 8).map((match) => {
              const label = itemWords(match.item, lang, list.ideas)
              return label ? (
                <li key={match.item} className="inline-flex items-center rounded-full bg-haze px-3 py-1.5 text-xs font-bold leading-tight">
                  {label}
                </li>
              ) : null
            })}
          </ul>
        )}
        {allWishes.length > 0 && <p className="text-sm">{c.common.wishes(allWishes.length, allWishes.filter((wish) => wish.answer?.decision === 'yes').length)}</p>}
        <Button variant="secondary" className="self-start" onClick={() => navigate('/list')}>
          {c.common.open}
        </Button>
      </Section>

      <Section id="about" title={c.sections.about}>
        <p className="text-sm text-ink-soft">{both.length > 0 ? c.about.lead : c.about.none}</p>
        {both.map((question) => {
          const words = question[lang]
          const mineAt = about.mine.get(question.id)?.body.value as number
          const theirsAt = about.theirs.get(question.id)?.body.value as number
          const marks = [
            { who: me, at: mineAt },
            { who: partner, at: theirsAt },
          ].sort((a, b) => a.who.createdAt.localeCompare(b.who.createdAt))
          return (
            <div key={question.id} data-testid={`ours-about-${question.id}`}>
              <p className="text-sm font-bold leading-snug">{words.ask}</p>
              {/* Two people on one line between the poles. The same place puts them side by side. */}
              <div className="relative mx-3.5 mt-5 h-7" aria-hidden>
                <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
                {marks.map(({ who, at }, index) => (
                  <span key={who.id} className="absolute top-1/2" style={{ left: `${((at - 1) / 4) * 100}%`, transform: `translate(-50%, -50%) translateX(${mineAt === theirsAt ? (index === 0 ? -12 : 12) : 0}px)` }}>
                    <Avatar avatar={who.avatar} color={who.color} accessory={null} size={26} />
                  </span>
                ))}
              </div>
              <div className="mt-1 flex justify-between gap-4 text-2xs font-semibold text-ink-soft">
                <span>{words.low}</span>
                <span className="text-right">{words.high}</span>
              </div>
              <ul className="mt-1.5 text-xs font-semibold">
                {marks.map(({ who, at }) => (
                  <li key={who.id}>{c.about.at(who.name, stepBetween(words.low, words.high, at, lang))}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </Section>
    </>
  )
}
