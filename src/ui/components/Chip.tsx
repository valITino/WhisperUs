import type { ReactNode } from 'react'
import { cx } from './cx'

interface Props {
  selected?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}

/** A filter chip. Filled means "on". */
export function Chip({ selected = false, onClick, children, className }: Props) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs font-bold whitespace-nowrap transition-colors duration-150',
        selected ? 'bg-ink text-ground' : 'bg-surface text-ink border-[1.5px] border-line-strong',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A small passive label, for example a course or a status. */
export function Tag({ tone = 'haze', children }: { tone?: 'haze' | 'moss' | 'gold' | 'wax'; children: ReactNode }) {
  const tones = {
    haze: 'bg-haze text-ink',
    moss: 'bg-moss text-on-candle',
    gold: 'bg-gold text-on-candle',
    wax: 'bg-wax text-on-wax',
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-extrabold', tones[tone])}>{children}</span>
}
