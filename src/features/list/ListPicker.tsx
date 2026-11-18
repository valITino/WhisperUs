// The list itself: groups of items as chips, each showing what I said to it. A tap opens
// one item. Used on the list's own page and in the first look after signing up.

import { useState } from 'react'
import type { ListState } from '../../data/queries'
import type { Lean } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { Button, cx } from '../../ui/components'
import { Icon, type IconName } from '../../ui/deco/Icon'
import { listCopy } from './copy'
import { IdeaSheet } from './IdeaSheet'
import { ItemSheet } from './ItemSheet'
import { OWN_SECTION, SECTIONS } from './library'

/** What a chip shows for each answer: a sign as well as a tone, never colour alone. */
const SIGN: Record<Lean, { icon: IconName; chip: string }> = {
  yes: { icon: 'heart', chip: 'bg-ink text-ground border-ink' },
  maybe: { icon: 'plus', chip: 'bg-haze text-ink border-line-strong' },
  dream: { icon: 'eye', chip: 'bg-surface text-ink border-accent border-dashed' },
  no: { icon: 'close', chip: 'bg-surface text-ink-soft border-line line-through decoration-1' },
}

interface Props {
  list: ListState
  /** The other one's name, or null while the second seat is empty. */
  partner: string | null
  /** Only these groups (the first look shows a handful). All of them when left out. */
  only?: readonly string[]
}

/** Every item of the list in the order it is shown, for "next one". */
export function orderOf(list: ListState): string[] {
  return [...SECTIONS.flatMap((section) => section.items.map((item) => item.id)), ...list.ideas.map((idea) => idea.id)]
}

export function ListPicker({ list, partner, only }: Props) {
  const c = useCopy(listCopy)
  const lang = useLang()
  const [open, setOpen] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const matched = new Set(list.matches.map((match) => match.item))

  const chip = (id: string, label: string) => {
    const mine = list.mine.get(id)
    const sign = mine ? SIGN[mine.lean] : null
    const common = matched.has(id)
    return (
      <li key={id}>
        <button
          type="button"
          data-testid={`item-${id}`}
          data-lean={mine?.lean ?? ''}
          aria-label={c.chip(label, mine ? c.lean[mine.lean] : c.unanswered, common)}
          onClick={() => setOpen(id)}
          className={cx(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 py-2 text-left text-xs font-bold leading-tight transition-colors duration-150',
            sign ? sign.chip : 'border-line-strong bg-surface text-ink',
            common && 'ring-2 ring-accent ring-offset-2 ring-offset-ground',
          )}
        >
          {sign && <Icon name={sign.icon} size={14} className="shrink-0" />}
          {label}
        </button>
      </li>
    )
  }

  const sections = only ? SECTIONS.filter((section) => only.includes(section.id)) : SECTIONS
  const order = orderOf(list)

  return (
    <div className="flex flex-col gap-6" data-testid="list-picker">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`list-${section.id}`}>
          <h3 id={`list-${section.id}`} className="mb-2.5 text-base">
            {section[lang]}
          </h3>
          <ul className="flex flex-wrap gap-2">{section.items.map((item) => chip(item.id, item[lang]))}</ul>
        </section>
      ))}

      {!only && (
        <section aria-labelledby={`list-${OWN_SECTION}`}>
          <h3 id={`list-${OWN_SECTION}`} className="mb-2.5 text-base">
            {c.ownSection}
          </h3>
          {list.ideas.length > 0 && <ul className="mb-3 flex flex-wrap gap-2">{list.ideas.map((idea) => chip(idea.id, idea.label))}</ul>}
          <Button variant="secondary" icon={<Icon name="pen" size={18} />} onClick={() => setWriting(true)}>
            {c.ownAdd}
          </Button>
        </section>
      )}

      {open && (
        <ItemSheet
          key={open}
          item={open}
          list={list}
          partner={partner}
          onClose={() => setOpen(null)}
          onNext={() => {
            // The next item nothing was said to yet, going round once.
            const from = order.indexOf(open)
            const rest = [...order.slice(from + 1), ...order.slice(0, from)]
            setOpen(rest.find((id) => !list.mine.has(id) && (!only || only.some((s) => id.startsWith(`${s}.`)))) ?? null)
          }}
        />
      )}
      <IdeaSheet open={writing} partner={partner} onClose={() => setWriting(false)} />
    </div>
  )
}
