// "Who sees this?": asked wherever somebody notes something about themselves. The
// gentlest answer is the one that is already chosen: only me. Showing is a choice made
// part by part, and nothing is ever shown on anybody's behalf.

import { useId } from 'react'
import { useCopy } from '../../i18n'
import { buzz, Chip, Segmented } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'

const copy = {
  en: {
    title: 'Who sees this?',
    me: 'Only me',
    both: (name: string) => `${name} too`,
    staysHere: 'It stays on this phone and goes nowhere else.',
    pick: (name: string) => `Tap what ${name} may see. Everything else stays on this phone.`,
    alone: 'It stays on this phone. Once your partner is here, you can choose what to show.',
    parts: 'What is shown',
  },
  de: {
    title: 'Wer sieht das?',
    me: 'Nur ich',
    both: (name: string) => `${name} auch`,
    staysHere: 'Es bleibt auf diesem Handy und geht nirgends sonst hin.',
    pick: (name: string) => `Tipp an, was ${name} sehen darf. Alles andere bleibt auf diesem Handy.`,
    alone: 'Es bleibt auf diesem Handy. Sobald dein Schatz da ist, kannst du wählen, was du zeigst.',
    parts: 'Was gezeigt wird',
  },
}

interface Props {
  /** The other one's name. Null while the second seat is empty. */
  partner: string | null
  /** The parts that were answered, in order. Only these can be shown. */
  parts: readonly { id: string; label: string }[]
  /** The parts that are shown. Empty: only me. */
  value: readonly string[]
  onChange: (shared: string[]) => void
  /** What "too" starts from: the parts shown the last time. Without it, everything answered. */
  remembered?: readonly string[] | null
}

export function ShareChoice({ partner, parts, value, onChange, remembered }: Props) {
  const c = useCopy(copy)
  const titleId = useId()
  const answered = parts.map((part) => part.id)
  const shown = value.filter((id) => answered.includes(id))
  const showing = shown.length > 0

  const toggle = (id: string) => {
    buzz(8)
    onChange(shown.includes(id) ? shown.filter((other) => other !== id) : [...shown, id])
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-testid="share-choice">
      <h3 id={titleId} className="flex items-center gap-2 text-lg">
        <Icon name={showing ? 'eye' : 'lock'} size={20} className="shrink-0 text-accent" />
        {c.title}
      </h3>
      {partner === null ? (
        <p className="text-sm text-ink-soft">{c.alone}</p>
      ) : (
        <>
          <Segmented<'me' | 'both'>
            label={c.title}
            value={showing ? 'both' : 'me'}
            options={[
              { value: 'me', label: c.me },
              { value: 'both', label: c.both(partner) },
            ]}
            onChange={(next) => {
              buzz(8)
              if (next === 'me') return onChange([])
              const again = (remembered ?? []).filter((id) => answered.includes(id))
              onChange(again.length > 0 ? again : answered)
            }}
          />
          {!showing && <p className="text-sm text-ink-soft">{c.staysHere}</p>}
          {showing && (
            <>
              <p className="text-sm text-ink-soft">{c.pick(partner)}</p>
              <div role="group" aria-label={c.parts} className="flex flex-wrap gap-2">
                {parts.map((part) => (
                  <Chip key={part.id} selected={shown.includes(part.id)} onClick={() => toggle(part.id)} className="whitespace-normal py-2 text-left leading-tight">
                    {part.label}
                  </Chip>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
