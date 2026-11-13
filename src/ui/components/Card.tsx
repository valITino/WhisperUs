import type { HTMLAttributes } from 'react'
import { cx } from './cx'

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** paper: plain card. haze: tinted. note: a hand-written note from the other person. */
  tone?: 'paper' | 'haze' | 'note'
  /** Only for things that truly float above the page. */
  raised?: boolean
  /** Set false to control the inner spacing yourself. */
  pad?: boolean
}

export function Card({ tone = 'paper', raised, pad = true, className, ...rest }: Props) {
  return (
    <div
      className={cx(
        'rounded-card',
        pad && (tone === 'note' ? 'p-5' : 'p-4'),
        tone === 'paper' && 'bg-surface border border-line',
        tone === 'haze' && 'bg-haze',
        tone === 'note' && 'bg-haze ruled',
        raised && 'shadow-float border-transparent',
        className,
      )}
      {...rest}
    />
  )
}
