// The list's own page: how it works, what the two of us have in common, and every item
// to answer, alone.

import { useEffect } from 'react'
import { markMatchesSeen, useList, usePartner } from '../../data/queries'
import { useCopy, useLang } from '../../i18n'
import { Card, HeatMeter, Loader, Tag } from '../../ui/components'
import { StepPage } from '../onboarding/parts'
import { listCopy } from './copy'
import { itemWords, SECTIONS } from './library'
import { ListPicker } from './ListPicker'

export function ListScreen() {
  const c = useCopy(listCopy)
  const lang = useLang()
  const list = useList()
  const partner = usePartner()

  // What is new stays marked while this page is open; it counts as seen once it was shown.
  const fresh = list ? [...list.fresh] : []
  const freshKey = fresh.join(',')
  useEffect(() => {
    if (!freshKey) return
    return () => void markMatchesSeen(freshKey.split(','))
  }, [freshKey])

  if (!list || partner === undefined) {
    return (
      <StepPage title={c.title} backTo="/wishes">
        <Loader />
      </StepPage>
    )
  }
  const total = SECTIONS.reduce((sum, section) => sum + section.items.length, 0) + list.ideas.length
  const known = list.matches.map((match) => ({ match, label: itemWords(match.item, lang, list.ideas) })).filter((m): m is { match: (typeof list.matches)[number]; label: string } => m.label !== null)

  return (
    <StepPage title={c.title} backTo="/wishes">
      <div className="flex flex-col gap-7 px-4" data-testid="list">
        <Card tone="haze" pad={false} className="p-4">
          <h2 className="text-base">{c.rule.title}</h2>
          <p className="mt-1.5 text-sm leading-snug">{partner ? c.rule.body(partner.name) : c.rule.alone}</p>
        </Card>

        {partner && (
          <section aria-labelledby="list-common">
            <h2 id="list-common" className="mb-2.5 px-1 text-lg">
              {c.common}
            </h2>
            {known.length === 0 ? (
              <p className="px-1 text-sm text-ink-soft">{c.commonNone(partner.name)}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="list-common-items">
                {known.map(({ match, label }) => (
                  <li key={match.item} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold leading-snug">{label}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                        {c.lean[match.mine.lean]} / {partner.name}: {c.lean[match.theirs.lean]}
                      </span>
                    </span>
                    {match.theirs.pull !== null && <HeatMeter label={c.theirPull(partner.name)} value={match.theirs.pull} size={16} />}
                    {list.fresh.has(match.item) && <Tag tone="wax">{c.commonNew}</Tag>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <p className="-mb-3 px-1 text-xs font-semibold text-ink-soft" data-testid="list-answered">
          {c.answered(list.mine.size, total)}
        </p>
        <ListPicker list={list} partner={partner?.name ?? null} />
      </div>
    </StepPage>
  )
}
