// Saying a wish, or rewording one that has not been answered yet: the words, what kind
// of wish it is, how much I want it, and why. It is read as soon as it is sent.

import { useState } from 'react'
import { back, navigate, useRoute } from '../../app/router'
import { useLeaveGuard } from '../../app/useLeaveGuard'
import { ActionError, changeWish, makeWish, WISH_MAX } from '../../data/do'
import { useList, usePartner, useWish } from '../../data/queries'
import { NO_WHY, type ID, type Score5, type Why, type Wish, type WishMode } from '../../data/types'
import { cleanWhy } from '../../data/why'
import { useCopy, useLang } from '../../i18n'
import { Button, Card, Loader, Options, Scale, Tag, TextArea, toast } from '../../ui/components'
import { itemWords } from '../list/library'
import { ConfirmSheet, ErrorNote, StepPage } from '../onboarding/parts'
import { WhyPicker } from '../why'
import { wishesCopy } from './copy'

/** /wishes/new (optionally ?item=…) and /wishes/:id/edit */
export function WishFormScreen({ id }: { id?: ID }) {
  const c = useCopy(wishesCopy)
  const lang = useLang()
  const route = useRoute()
  const list = useList()
  const partner = usePartner()
  const existing = useWish(id ?? '')

  if (!list || partner === undefined || (id && existing === undefined)) {
    return (
      <StepPage title={id ? c.form.editTitle : c.form.newTitle} backTo="/wishes">
        <Loader />
      </StepPage>
    )
  }
  // Rewording is for my own wish while it waits. Anything else leads back to where it can be read.
  if (id && (!existing || !existing.mine || existing.wish.answer)) {
    const to = existing ? `/wishes/${id}` : '/wishes'
    queueMicrotask(() => navigate(to, { replace: true }))
    return (
      <StepPage title={c.form.editTitle} backTo="/wishes">
        <Loader />
      </StepPage>
    )
  }
  const wish = id && existing ? existing.wish : null
  const item = wish ? wish.item : route.query.get('item')
  const itemLabel = item ? itemWords(item, lang, list.ideas) : null
  return <Form key={wish?.id ?? `new:${item ?? ''}`} wish={wish} item={itemLabel ? item : null} itemLabel={itemLabel} partner={partner?.name ?? ''} />
}

function Form({ wish, item, itemLabel, partner }: { wish: Wish | null; item: string | null; itemLabel: string | null; partner: string }) {
  const c = useCopy(wishesCopy)
  const f = c.form
  const [text, setText] = useState(wish?.text ?? itemLabel ?? '')
  const [mode, setMode] = useState<WishMode>(wish?.mode ?? 'do')
  const [want, setWant] = useState<Score5 | null>(wish?.want ?? null)
  const [why, setWhy] = useState<Why>(wish?.why ?? NO_WHY)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const start = wish?.text ?? itemLabel ?? ''
  const dirty = text.trim() !== start.trim() || want !== (wish?.want ?? null) || mode !== (wish?.mode ?? 'do') || JSON.stringify(cleanWhy(why)) !== JSON.stringify(cleanWhy(wish?.why ?? NO_WHY))
  const guard = useLeaveGuard(dirty && !busy, () => back(wish ? `/wishes/${wish.id}` : '/wishes'))

  const send = async () => {
    setProblem(null)
    setBusy(true)
    try {
      const draft = { text, item, mode, want, why }
      const id = wish ? (await changeWish(wish.id, draft), wish.id) : await makeWish(draft)
      guard.release()
      toast(wish ? f.saved : f.sent)
      navigate(`/wishes/${id}`, { replace: true })
    } catch (e) {
      setBusy(false)
      const code = e instanceof ActionError ? e.code : 'other'
      setProblem(code === 'no_words' ? f.problems.no_words : code === 'answered' ? f.problems.answered : f.problems.other)
    }
  }

  return (
    <div data-testid="wish-form">
      <StepPage
        title={wish ? f.editTitle : f.newTitle}
        backTo={wish ? `/wishes/${wish.id}` : '/wishes'}
        footer={
          <>
            {problem && <ErrorNote>{problem}</ErrorNote>}
            <Button size="lg" block disabled={busy} onClick={() => void send()}>
              {wish ? f.save : f.send}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6 px-4">
          {itemLabel && (
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-soft">
              {f.fromList}
              <Tag>{itemLabel}</Tag>
            </p>
          )}
          <TextArea label={f.text} placeholder={f.textPlaceholder} value={text} maxLength={WISH_MAX} rows={4} onChange={(e) => setText(e.target.value)} />

          <div>
            <p className="mb-2 text-sm font-bold">{f.kind}</p>
            <Options<WishMode> label={f.kind} stacked value={mode} options={(['do', 'dream'] as const).map((value) => ({ value, label: c.mode[value], hint: c.modeHint[value] || undefined }))} onChange={(next) => next && setMode(next)} />
          </div>

          <div>
            <p className="mb-1 text-sm font-bold">{f.want}</p>
            <Scale label={f.want} value={want} low={f.wantLow} high={f.wantHigh} onChange={setWant} />
          </div>

          <Card pad={false} className="p-4">
            <WhyPicker context="wish" value={why} onChange={setWhy} title={f.why} />
          </Card>

          {partner && !wish && <p className="text-xs leading-snug text-ink-soft">{f.plain(partner)}</p>}
        </div>
      </StepPage>
      <ConfirmSheet open={guard.asking} title={f.discardTitle} confirmLabel={f.discard} cancelLabel={f.stay} onClose={guard.stay} onConfirm={guard.discard}>
        <p>{f.discardBody}</p>
      </ConfirmSheet>
    </div>
  )
}
