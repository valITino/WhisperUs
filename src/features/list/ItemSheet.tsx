// One item of the list: what I think of it, how strong the pull is, why, and whether
// it may meet the other one's answer at all. Where we meet, their answer shows too.

import { useState } from 'react'
import { navigate } from '../../app/router'
import { removeIdea, saveLeaning } from '../../data/do'
import type { ListState } from '../../data/queries'
import { NO_WHY, type Lean, type Score5, type Why } from '../../data/types'
import { isEmptyWhy } from '../../data/why'
import { useCopy, useLang } from '../../i18n'
import { Button, Card, HeatMeter, Options, Sheet, toast, Toggle } from '../../ui/components'
import { ErrorNote } from '../onboarding/parts'
import { WhyPicker, WhyView } from '../why'
import { listCopy } from './copy'
import { itemWords } from './library'

const LEANS: Lean[] = ['yes', 'maybe', 'dream', 'no']

interface Props {
  item: string
  list: ListState
  partner: string | null
  onClose: () => void
  /** Open the next item nothing was said to yet. */
  onNext: () => void
}

export function ItemSheet({ item, list, partner, onClose, onNext }: Props) {
  const c = useCopy(listCopy)
  const lang = useLang()
  const before = list.mine.get(item)
  const match = list.matches.find((m) => m.item === item)
  const idea = list.ideas.find((i) => i.id === item)
  const [lean, setLean] = useState<Lean | null>(before?.lean ?? null)
  const [pull, setPull] = useState<Score5 | null>(before?.pull ?? null)
  const [why, setWhy] = useState<Why>(before?.why ?? NO_WHY)
  const [whyOpen, setWhyOpen] = useState(!isEmptyWhy(before?.why))
  const [quiet, setQuiet] = useState(before?.quiet ?? false)
  const [showWhy, setShowWhy] = useState(before?.whyShown ?? false)
  const [problem, setProblem] = useState(false)
  const open = lean !== null && lean !== 'no'

  const save = async (then: () => void) => {
    try {
      if (lean === null) await saveLeaning(item, null)
      else await saveLeaning(item, { lean, ...(pull !== null && open ? { pull } : {}), ...(!isEmptyWhy(why) ? { why } : {}), ...(quiet && open ? { quiet: true } : {}) }, { showWhy: showWhy && open && !quiet })
      toast(lean === null ? c.cleared : c.saved)
      then()
    } catch {
      setProblem(true)
    }
  }

  const clear = async () => {
    try {
      await saveLeaning(item, null)
      toast(c.cleared)
      onClose()
    } catch {
      setProblem(true)
    }
  }

  const offList = async () => {
    try {
      await saveLeaning(item, null)
      await removeIdea(item)
      toast(c.offListDone)
      onClose()
    } catch {
      setProblem(true)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={itemWords(item, lang, list.ideas) ?? ''}
      footer={
        <div className="flex flex-col gap-2">
          {problem && <ErrorNote>{c.problem}</ErrorNote>}
          <Button block size="lg" disabled={lean === null && !before} onClick={() => void save(onClose)}>
            {c.save}
          </Button>
          <Button variant="secondary" block disabled={lean === null && !before} onClick={() => void save(onNext)}>
            {c.next}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pb-1" data-testid="item-sheet">
        {match && partner && (
          <Card tone="note" pad={false} className="flex flex-col gap-2 p-5" data-testid="item-match">
            <p className="whispered text-lg leading-tight text-accent">{c.met(partner)}</p>
            <p className="text-sm font-bold">
              {c.theirs(partner)}: {c.lean[match.theirs.lean]}
            </p>
            {match.theirs.pull !== null && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold">{c.pullWords[match.theirs.pull - 1]}</span>
                <HeatMeter label={c.theirPull(partner)} value={match.theirs.pull} size={20} />
              </div>
            )}
            {match.theirs.why && <WhyView why={match.theirs.why} />}
            <Button variant="secondary" className="mt-1 self-start" onClick={() => navigate(`/wishes/new?item=${encodeURIComponent(item)}`)}>
              {c.wish}
            </Button>
          </Card>
        )}

        <div>
          <p className="mb-2 text-sm font-bold">{c.ask}</p>
          <Options<Lean> label={c.ask} stacked value={lean} options={LEANS.map((value) => ({ value, label: c.lean[value], hint: c.leanHint[value] || undefined }))} onChange={setLean} />
        </div>

        {open && (
          <div>
            <p className="mb-1 text-sm font-bold">{c.pull}</p>
            <HeatMeter label={c.pull} value={pull} onChange={setPull} words={c.pullWords} />
          </div>
        )}

        {lean !== null &&
          (whyOpen ? (
            <WhyPicker context="leaning" value={why} onChange={setWhy} title={c.whyTitle} />
          ) : (
            <Button variant="secondary" className="self-start" onClick={() => setWhyOpen(true)}>
              {c.whyOpen}
            </Button>
          ))}

        {open && (
          <Card pad={false} className="divide-y divide-line px-4">
            <div className="py-1">
              <Toggle label={c.quiet} checked={quiet} onChange={setQuiet} />
              <p className="pb-2.5 text-xs leading-snug text-ink-soft">{c.quietHint}</p>
            </div>
            {!quiet && !isEmptyWhy(why) && (
              <div className="py-1">
                <Toggle label={partner ? c.showWhy(partner) : c.showWhyAlone} checked={showWhy} onChange={setShowWhy} />
              </div>
            )}
          </Card>
        )}

        {before && (
          <Button variant="quiet" onClick={() => void clear()}>
            {c.clear}
          </Button>
        )}
        {idea && idea.authorId === list.meId && (
          <Button variant="quiet" onClick={() => void offList()}>
            {c.offList}
          </Button>
        )}
      </div>
    </Sheet>
  )
}
