// The avatar maker: pick a sign, a colour and something to wear, and watch
// the big preview react to every tap.

import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { useCopy } from '../../i18n'
import { ACCESSORIES, Avatar, AVATARS, buzz, cx } from '../../ui/components'
import { profileCopy } from './copy'
import { DISC_COLORS, type ProfileDraft } from './draft'

type Change = 'avatar' | 'color' | 'accessory'

/** How the big preview answers each kind of change. */
const REACTIONS: Record<Change, { from: Record<string, number>; spring: { stiffness: number; damping: number } }> = {
  avatar: { from: { scale: 0.72, rotate: -10, y: 0 }, spring: { stiffness: 480, damping: 13 } },
  color: { from: { scale: 0.92, rotate: 14, y: 0 }, spring: { stiffness: 420, damping: 12 } },
  accessory: { from: { scale: 1.04, rotate: 0, y: -14 }, spring: { stiffness: 620, damping: 11 } },
}

interface OptionProps {
  label: string
  selected: boolean
  onSelect: () => void
  children: ReactNode
  /** Show the label under the picture (otherwise it is only read aloud). */
  showLabel?: boolean
  className?: string
}

function Option({ label, selected, onSelect, children, showLabel = false, className }: OptionProps) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 600, damping: 20 }}
      onClick={onSelect}
      className={cx(
        'flex min-h-16 flex-col items-center justify-end gap-1.5 rounded-2xl border-[1.5px] px-1 pb-2 transition-colors duration-150',
        selected ? 'border-ink bg-surface' : 'border-transparent',
        className,
      )}
    >
      {children}
      {showLabel && <span className={cx('text-2xs leading-none', selected ? 'font-extrabold' : 'font-bold text-ink-soft')}>{label}</span>}
    </motion.button>
  )
}

function Group({ label, columns, children }: { label: string; columns: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-extrabold">{label}</p>
      <div role="radiogroup" aria-label={label} className={cx('grid gap-1.5', columns)}>
        {children}
      </div>
    </div>
  )
}

interface Props {
  draft: ProfileDraft
  onChange: (patch: Partial<ProfileDraft>) => void
}

export function AvatarMaker({ draft, onChange }: Props) {
  const c = useCopy(profileCopy)
  // Which kind of change came last decides how the preview moves. Nothing moves on first paint.
  const [last, setLast] = useState<{ kind: Change; count: number }>({ kind: 'avatar', count: 0 })

  const pick = (kind: Change, patch: Partial<ProfileDraft>) => {
    buzz(kind === 'accessory' ? [8, 30, 8] : 10)
    setLast((was) => ({ kind, count: was.count + 1 }))
    onChange(patch)
  }

  const reaction = REACTIONS[last.kind]
  const name = draft.name.trim() || c.you

  return (
    <section aria-labelledby="look-title">
      <h2 id="look-title" className="px-4 text-lg">
        {c.lookTitle}
      </h2>

      {/* The stage stays in view while you try things on. */}
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+var(--banner-h,0px))] z-20 mt-3 border-y border-line bg-haze">
        <div className="flex items-center justify-center gap-4 px-5 py-4">
          <div className="grid size-[132px] shrink-0 place-items-center rounded-full border border-line bg-surface">
            <motion.div
              key={last.count}
              initial={last.count ? reaction.from : false}
              animate={{ scale: 1, rotate: 0, y: 0 }}
              transition={{ type: 'spring', ...reaction.spring }}
              data-testid="avatar-preview"
              className="grid"
            >
              <Avatar avatar={draft.avatar} color={draft.color} accessory={draft.accessory} size={104} name={c.previewLabel(name)} />
            </motion.div>
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-semibold leading-tight">{name}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-4 pt-5">
        <Group label={c.characterLabel} columns="grid-cols-4">
          {AVATARS.map((avatar) => (
            <Option key={avatar} label={c.characters[avatar] ?? avatar} selected={draft.avatar === avatar} onSelect={() => pick('avatar', { avatar })} className="pt-2">
              <Avatar avatar={avatar} color={draft.color} size={52} />
            </Option>
          ))}
        </Group>

        <Group label={c.plateLabel} columns="grid-cols-4">
          {DISC_COLORS.map((color) => (
            <Option key={color} label={c.plates[color] ?? color} selected={draft.color === color} onSelect={() => pick('color', { color })} showLabel className="pt-2">
              <Avatar avatar={draft.avatar} color={color} size={44} />
            </Option>
          ))}
        </Group>

        <Group label={c.accessoryLabel} columns="grid-cols-3">
          {[null, ...ACCESSORIES].map((accessory) => (
            <Option
              key={accessory ?? 'none'}
              label={c.accessories[accessory ?? 'none'] ?? String(accessory)}
              selected={draft.accessory === accessory}
              onSelect={() => pick('accessory', { accessory })}
              showLabel
              className="pt-5"
            >
              <Avatar avatar={draft.avatar} color={draft.color} accessory={accessory} size={48} />
            </Option>
          ))}
        </Group>
      </div>
    </section>
  )
}
