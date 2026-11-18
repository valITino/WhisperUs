// One question about myself: a step between two poles, a why if I like, and who sees it.
// Used on the page "About me" and in the first look after signing up.

import { useState } from 'react'
import { NO_WHY, type AboutBody, type AboutPart, type Score5, type Why } from '../../data/types'
import { isEmptyWhy } from '../../data/why'
import { useCopy, useLang } from '../../i18n'
import { Button, Scale } from '../../ui/components'
import { ShareChoice } from '../share/ShareChoice'
import { WhyPicker } from '../why'
import { aboutCopy } from './copy'
import type { Question } from './library'

export interface AnswerDraft {
  value: Score5 | null
  why: Why
  share: string[]
}

export const emptyAnswer: AnswerDraft = { value: null, why: NO_WHY, share: [] }

export const draftOf = (answer: { body: AboutBody; shared: string[] } | undefined): AnswerDraft => (answer ? { value: answer.body.value ?? null, why: answer.body.why ?? NO_WHY, share: answer.shared } : emptyAnswer)

/** What goes to the action: the answer, and the parts of it that are shown. */
export function toAnswer(draft: AnswerDraft): { body: AboutBody; share: AboutPart[] } {
  const body: AboutBody = { ...(draft.value !== null ? { value: draft.value } : {}), ...(!isEmptyWhy(draft.why) ? { why: draft.why } : {}) }
  return { body, share: (['value', 'why'] as const).filter((part) => draft.share.includes(part) && body[part] !== undefined) }
}

interface Props {
  question: Question
  value: AnswerDraft
  onChange: (next: AnswerDraft) => void
  partner: string | null
}

export function QuestionForm({ question, value, onChange, partner }: Props) {
  const c = useCopy(aboutCopy)
  const lang = useLang()
  const words = question[lang]
  const [whyOpen, setWhyOpen] = useState(!isEmptyWhy(value.why))
  const parts = [...(value.value !== null ? [{ id: 'value', label: c.part.value }] : []), ...(!isEmptyWhy(value.why) ? [{ id: 'why', label: c.part.why }] : [])]

  return (
    <div className="flex flex-col gap-6" data-testid={`question-${question.id}`}>
      <Scale label={words.ask} value={value.value} low={words.low} high={words.high} onChange={(next) => onChange({ ...value, value: next })} />
      {whyOpen ? (
        <WhyPicker context="about" value={value.why} onChange={(why) => onChange({ ...value, why })} title={c.whyTitle} />
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setWhyOpen(true)}>
          {c.whyOpen}
        </Button>
      )}
      {parts.length > 0 && <ShareChoice partner={partner} parts={parts} value={value.share} onChange={(share) => onChange({ ...value, share })} />}
    </div>
  )
}
