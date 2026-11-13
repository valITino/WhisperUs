// Plays a voice note that is already open on this phone. The sound never gets an address
// anybody could share: it is a blob in memory, and its address dies with this component.

import { useEffect, useRef, useState } from 'react'
import { clock } from '../../lib/when'
import { cx } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'

interface Props {
  sound: Blob
  /** Its length as the recorder measured it: browsers often cannot tell for a fresh recording. */
  seconds: number
  labels: { play: string; pause: string; length: (clock: string) => string }
  className?: string
}

export function Player({ sound, seconds, labels, className }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)

  useEffect(() => {
    const next = URL.createObjectURL(sound)
    setUrl(next)
    setPlaying(false)
    setAt(0)
    return () => URL.revokeObjectURL(next)
  }, [sound])

  const toggle = () => {
    const element = audio.current
    if (!element) return
    if (playing) element.pause()
    else void element.play().catch(() => setPlaying(false))
  }

  const total = Math.max(seconds, 1)
  return (
    // The play button is drawn in ink, not in candle: a page has one main button, and listening is never it.
    <div className={cx('flex items-center gap-3 rounded-card border border-line bg-surface p-3', className)} data-testid="player">
      <button
        type="button"
        aria-label={playing ? labels.pause : labels.play}
        onClick={toggle}
        className="grid size-12 shrink-0 place-items-center rounded-full border-[1.5px] border-accent bg-surface text-accent shadow-[0_3px_0_var(--color-line)] active:translate-y-[2px] active:shadow-[0_1px_0_var(--color-line)]"
      >
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-line-strong" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.min(100, (at / total) * 100)}%` }} />
        </div>
        <p className="tabular mt-1.5 text-xs font-semibold text-ink-soft">{playing || at > 0 ? `${clock(at)} / ${clock(total)}` : labels.length(clock(total))}</p>
      </div>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setAt(0)
          }}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        />
      )}
    </div>
  )
}
