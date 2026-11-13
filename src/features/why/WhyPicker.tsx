// "And why?": the same picker wherever somebody chooses or rates. Reasons to tap, room
// for words of one's own, and a sentence more. Everything in it is optional.

import { useId, useState } from 'react'
import type { Why } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { buzz, Chip, cx, TextArea } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { whyCopy } from './copy'
import { LIBRARY, NOTE_MAX, OWN_LIMIT, OWN_MAX, type Tone, type WhyContext } from './library'

interface Props {
  context: WhyContext
  value: Why
  onChange: (why: Why) => void
  /** The question, as a heading: "And why?" */
  title: string
}

export function WhyPicker({ context, value, onChange, title }: Props) {
  const c = useCopy(whyCopy)
  const lang = useLang()
  const titleId = useId()
  const ownId = useId()
  const [word, setWord] = useState('')

  const toggle = (id: string) => {
    buzz(8)
    onChange({ ...value, chips: value.chips.includes(id) ? value.chips.filter((chip) => chip !== id) : [...value.chips, id] })
  }

  const addOwn = () => {
    const clean = word.trim().slice(0, OWN_MAX)
    if (!clean || value.own.includes(clean) || value.own.length >= OWN_LIMIT) return
    buzz(8)
    onChange({ ...value, own: [...value.own, clean] })
    setWord('')
  }

  const group = (tone: Tone, label: string) => (
    <div role="group" aria-label={label}>
      <p className="mb-2 text-xs font-bold text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2">
        {LIBRARY[context]
          .filter((reason) => reason.tone === tone)
          .map((reason) => (
            <Chip key={reason.id} selected={value.chips.includes(reason.id)} onClick={() => toggle(reason.id)} className="whitespace-normal py-2 text-left leading-tight">
              {reason[lang]}
            </Chip>
          ))}
      </div>
    </div>
  )

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4" data-testid={`why-${context}`}>
      <div>
        <h3 id={titleId} className="text-lg">
          {title}
        </h3>
        <p className="mt-1 text-xs text-ink-soft">{c.both}</p>
      </div>
      {group('warm', c.warm)}
      {group('tender', c.tender)}

      <div>
        <label htmlFor={ownId} className="mb-2 block text-xs font-bold text-ink-soft">
          {c.ownLabel}
        </label>
        {value.own.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {value.own.map((own) => (
              <button
                key={own}
                type="button"
                aria-label={c.ownRemove(own)}
                onClick={() => onChange({ ...value, own: value.own.filter((other) => other !== own) })}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink py-2 pl-4 pr-3 text-left text-xs font-bold leading-tight text-ground"
              >
                {own}
                <Icon name="close" size={14} />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <input
            id={ownId}
            value={word}
            maxLength={OWN_MAX}
            placeholder={c.ownPlaceholder}
            enterKeyHint="done"
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              addOwn()
            }}
            className="min-h-12 min-w-0 flex-1 rounded-field border-[1.5px] border-line-strong bg-surface px-3.5 text-sm outline-none placeholder:text-ink-soft/70 focus:border-accent"
          />
          <button
            type="button"
            onClick={addOwn}
            disabled={!word.trim() || value.own.length >= OWN_LIMIT}
            className={cx('min-h-12 shrink-0 rounded-field border-[1.5px] border-line-strong bg-surface px-4 text-xs font-extrabold disabled:opacity-40')}
          >
            {c.ownAdd}
          </button>
        </div>
      </div>

      <TextArea label={c.noteLabel} placeholder={c.notePlaceholder} value={value.note ?? ''} maxLength={NOTE_MAX} rows={2} onChange={(e) => onChange({ ...value, note: e.target.value })} />
    </section>
  )
}
