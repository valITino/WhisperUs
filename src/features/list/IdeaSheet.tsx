// Writing something of one's own onto the list. Both will see it there; neither learns
// from it what the other one answers.

import { useState } from 'react'
import { addIdea, IDEA_MAX } from '../../data/do'
import { useCopy } from '../../i18n'
import { Button, Field, Sheet, toast } from '../../ui/components'
import { ErrorNote } from '../onboarding/parts'
import { listCopy } from './copy'
import { OWN_SECTION } from './library'

export function IdeaSheet({ open, partner, onClose }: { open: boolean; partner: string | null; onClose: () => void }) {
  const c = useCopy(listCopy)
  const [label, setLabel] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    if (!label.trim()) return setProblem(c.ownMissing)
    try {
      await addIdea(label, OWN_SECTION)
      toast(c.ownSaved)
      setLabel('')
      setProblem(null)
      onClose()
    } catch {
      setProblem(c.problem)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={c.ownTitle}
      footer={
        <Button block size="lg" onClick={() => void save()}>
          {c.ownSave}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <Field
          label={c.ownLabel}
          placeholder={c.ownPlaceholder}
          hint={partner ? c.ownHint(partner) : c.ownHintAlone}
          value={label}
          maxLength={IDEA_MAX}
          enterKeyHint="done"
          onChange={(e) => {
            setLabel(e.target.value)
            setProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        {problem && <ErrorNote>{problem}</ErrorNote>}
      </div>
    </Sheet>
  )
}
