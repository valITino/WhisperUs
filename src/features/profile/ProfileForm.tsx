// The parts a profile is made of: the name field, the avatar maker
// (in AvatarMaker.tsx) and the status line. The start wizard shows them one per step;
// Settings shows them together as ProfileForm. The caller owns the draft and the buttons.

import { motion } from 'motion/react'
import { useState } from 'react'
import { useCopy } from '../../i18n'
import { Button, buzz, Chip, cx, Field } from '../../ui/components'
import { Sparkle } from '../../ui/deco/Deco'
import { AvatarMaker } from './AvatarMaker'
import { profileCopy } from './copy'
import { clip, NAME_MAX, nextSuggestion, STATUS_MAX, type ProfileDraft } from './draft'
import { ProfileBubble } from './ProfileBubble'

const NAME_FIELD_ID = 'profile-name'

/** Bring the name field into view and put the cursor in it (after "your name is missing"). */
export function focusNameField(): void {
  const field = document.getElementById(NAME_FIELD_ID)
  field?.scrollIntoView({ block: 'center' })
  field?.focus({ preventScroll: true })
}

interface Props {
  draft: ProfileDraft
  onChange: (patch: Partial<ProfileDraft>) => void
}

/** The name. It is also what the person logs in with, and the hint says so. */
export function NameField({ draft, onChange }: Props) {
  const c = useCopy(profileCopy)
  return (
    <Field
      id={NAME_FIELD_ID}
      label={c.nameLabel}
      hint={c.nameHint}
      placeholder={c.namePlaceholder}
      value={draft.name}
      maxLength={NAME_MAX}
      autoComplete="off"
      autoCapitalize="words"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      onChange={(e) => onChange({ name: e.target.value })}
    />
  )
}

/** The status line: a live bubble, the field with its counter, and suggestions to borrow. */
export function StatusEditor({ draft, onChange }: Props) {
  const c = useCopy(profileCopy)
  const [hops, setHops] = useState(0)
  const used = draft.status.length
  const suggestions = c.suggestions

  const take = (status: string) => {
    buzz([10, 40, 14])
    setHops((n) => n + 1)
    onChange({ status })
  }

  return (
    <div className="flex flex-col gap-3">
      <ProfileBubble
        name={draft.name.trim() || c.you}
        status={draft.status}
        placeholder={c.statusEmpty}
        avatar={draft.avatar}
        color={draft.color}
        accessory={draft.accessory}
        hop={hops}
      />
      <Field
        label={c.statusLabel}
        hint={c.statusHint}
        placeholder={c.statusPlaceholder}
        value={draft.status}
        maxLength={STATUS_MAX}
        enterKeyHint="done"
        onChange={(e) => onChange({ status: clip(e.target.value, STATUS_MAX) })}
      />
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => take(nextSuggestion(suggestions, draft.status))}
          icon={
            <motion.span key={hops} initial={hops ? { rotate: -90, scale: 0.6 } : false} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }} className="grid">
              <Sparkle size={18} />
            </motion.span>
          }
        >
          {c.surprise}
        </Button>
        <span role="status" data-testid="status-counter" className={cx('tabular text-xs', used >= STATUS_MAX ? 'font-extrabold text-ink' : 'font-bold text-ink-soft')}>
          <span aria-hidden>{c.counter(used, STATUS_MAX)}</span>
          <span className="sr-only">{c.counterLabel(used, STATUS_MAX)}</span>
        </span>
      </div>
      <div>
        <p className="mb-2 text-xs font-extrabold">{c.statusBorrow}</p>
        <div className="flex flex-wrap gap-2" data-testid="status-suggestions">
          {suggestions.slice(0, 4).map((line) => (
            <Chip key={line} selected={draft.status === line} onClick={() => take(line)}>
              {line}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Everything at once, for "My profile" in Settings. */
export function ProfileForm({ draft, onChange }: Props) {
  const c = useCopy(profileCopy)

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 px-4">
        <NameField draft={draft} onChange={onChange} />
      </section>

      <AvatarMaker draft={draft} onChange={onChange} />

      <section aria-labelledby="status-title" className="flex flex-col gap-3 px-4">
        <h2 id="status-title" className="text-lg">
          {c.statusTitle}
        </h2>
        <StatusEditor draft={draft} onChange={onChange} />
      </section>
    </div>
  )
}
