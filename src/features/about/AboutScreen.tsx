// "About me": the questions I answered about myself, to change whenever I stand
// somewhere else, and what the other one chose to show me of theirs.

import { useState } from 'react'
import { saveAbout } from '../../data/do'
import { useAbout, usePartner } from '../../data/queries'
import { useCopy, useLang } from '../../i18n'
import { Button, Card, Loader, Sheet, Tag, toast } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { ErrorNote, StepPage } from '../onboarding/parts'
import { stepBetween } from '../share/steps'
import { WhyView } from '../why'
import { aboutCopy } from './copy'
import { QUESTIONS, questionWords, type Question } from './library'
import { draftOf, QuestionForm, toAnswer, type AnswerDraft } from './QuestionForm'

export function AboutScreen() {
  const c = useCopy(aboutCopy)
  const lang = useLang()
  const about = useAbout()
  const partner = usePartner()
  const [editing, setEditing] = useState<Question | null>(null)

  if (!about || partner === undefined) {
    return (
      <StepPage title={c.title} backTo="/cockpit">
        <Loader />
      </StepPage>
    )
  }
  const shown = [...about.theirs.values()]

  return (
    <StepPage title={c.title} backTo="/cockpit">
      <div className="flex flex-col gap-6 px-4" data-testid="about">
        <p className="text-sm text-ink-soft">{c.lead}</p>
        <ul className="flex flex-col gap-2.5">
          {QUESTIONS.map((question) => {
            const answer = about.mine.get(question.id)
            const words = question[lang]
            return (
              <li key={question.id}>
                <button
                  type="button"
                  data-testid={`about-${question.id}`}
                  onClick={() => setEditing(question)}
                  className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left active:translate-y-[2px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold leading-snug">{words.ask}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={answer?.body.value ? 'text-sm font-semibold text-accent' : 'text-sm text-ink-soft'}>
                        {answer?.body.value ? stepBetween(words.low, words.high, answer.body.value, lang) : answer ? c.part.why : c.notYet}
                      </span>
                      {answer && <Tag tone={answer.shared.length > 0 ? 'gold' : 'haze'}>{answer.shared.length > 0 ? c.shownTag : c.mineTag}</Tag>}
                    </span>
                  </span>
                  <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
                </button>
              </li>
            )
          })}
        </ul>

        {partner && (
          <section aria-labelledby="about-theirs">
            <h2 id="about-theirs" className="mb-2.5 px-1 text-lg">
              {c.theirs(partner.name)}
            </h2>
            {shown.length === 0 ? (
              <p className="px-1 text-sm text-ink-soft">{c.theirsNone(partner.name)}</p>
            ) : (
              <ul className="flex flex-col gap-2.5" data-testid="about-theirs-list">
                {shown.map((answer) => {
                  const words = questionWords(answer.ref, lang)
                  return (
                    <li key={answer.id}>
                      <Card tone="haze" pad={false} className="flex flex-col gap-2 p-4">
                        <p className="text-sm font-bold leading-snug">{words.ask}</p>
                        {answer.body.value && <p className="text-sm font-semibold text-accent">{stepBetween(words.low, words.high, answer.body.value, lang)}</p>}
                        {answer.body.why && <WhyView why={answer.body.why} />}
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {editing && <EditSheet key={editing.id} question={editing} initial={draftOf(about.mine.get(editing.id))} whole={about.mine.get(editing.id)?.whole ?? true} partner={partner?.name ?? null} onClose={() => setEditing(null)} />}
    </StepPage>
  )
}

function EditSheet({ question, initial, whole, partner, onClose }: { question: Question; initial: AnswerDraft; whole: boolean; partner: string | null; onClose: () => void }) {
  const c = useCopy(aboutCopy)
  const lang = useLang()
  const [draft, setDraft] = useState(initial)
  const [problem, setProblem] = useState(false)
  const had = initial.value !== null || initial.why.chips.length + initial.why.own.length > 0 || Boolean(initial.why.note)

  const save = async (answer: AnswerDraft, said: string) => {
    try {
      const { body, share } = toAnswer(answer)
      await saveAbout(question.id, body, share)
      toast(said)
      onClose()
    } catch {
      setProblem(true)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={question[lang].ask}
      footer={
        <div className="flex flex-col gap-1.5">
          {problem && <ErrorNote>{c.problem}</ErrorNote>}
          <Button block size="lg" onClick={() => void save(draft, c.saved)}>
            {c.save}
          </Button>
          {had && (
            <Button variant="quiet" block onClick={() => void save({ ...draft, value: null, why: { chips: [], own: [], note: null } }, c.cleared)}>
              {c.clear}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        {!whole && <p className="text-xs font-semibold text-ink-soft">{c.notWhole}</p>}
        <QuestionForm question={question} value={draft} onChange={setDraft} partner={partner} />
      </div>
    </Sheet>
  )
}
