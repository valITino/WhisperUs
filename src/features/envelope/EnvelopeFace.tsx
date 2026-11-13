// The envelope as an object: cream paper, the flap's fold, the wax seal where the flap
// ends, and whatever its author wrote on the outside, in handwriting. The one thing in
// the app that is drawn like a thing. Its colours are fixed, by day and after dark.

import type { Heat } from '../../data/types'
import { cx } from '../../ui/components'
import { Flame, SealShape, type SealMark } from '../../ui/deco/Deco'

interface Props {
  /** The line on the outside. */
  teaser?: string | null
  /** Shown as flames in the corner, when the author wants the heat on the outside. */
  heat?: Heat | null
  /** sealed: closed. ready: closed, and asking to be opened. open: the seal is broken. */
  state?: 'sealed' | 'ready' | 'open'
  mark?: SealMark
  /** Read aloud instead of the drawing. */
  label: string
  className?: string
}

export function EnvelopeFace({ teaser, heat, state = 'sealed', mark = 'keyhole', label, className }: Props) {
  const line = teaser?.trim()
  return (
    <div
      role="img"
      aria-label={label}
      data-testid="envelope-face"
      data-state={state}
      className={cx('relative aspect-[5/3] w-full overflow-hidden rounded-paper bg-art-paper shadow-paper', className)}
    >
      {/* The flap: two folds from the top corners to the middle. */}
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden>
        <path d="M0 0 50 33 100 0Z" fill="var(--color-art-paper-shade)" opacity=".5" />
        <path d="M0 0 50 33 100 0" fill="none" stroke="var(--color-art-paper-shade)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <path d="M0 60 38 30M100 60 62 30" fill="none" stroke="var(--color-art-paper-shade)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>

      {heat != null && (
        <div className="absolute left-2.5 top-2 flex text-art-plum" aria-hidden>
          {Array.from({ length: heat }, (_, i) => (
            <Flame key={i} size={18} />
          ))}
        </div>
      )}

      <div className={cx('absolute left-1/2 top-[55%] w-[27%] -translate-x-1/2 -translate-y-1/2', state === 'ready' && 'rounded-full [animation:soft-pulse_2.2s_ease-in-out_infinite]')} aria-hidden>
        <svg viewBox="0 0 64 64" className="block w-full drop-shadow-[0_3px_4px_#861a2b59]">
          <SealShape mark={mark} broken={state === 'open'} />
        </svg>
      </div>

      {line && (
        <p className="handwritten absolute inset-x-4 bottom-2 line-clamp-2 text-center text-[1.35rem] leading-[1.15] text-art-plum" aria-hidden>
          {line}
        </p>
      )}
    </div>
  )
}
