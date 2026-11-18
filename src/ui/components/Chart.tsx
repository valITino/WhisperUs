// The two drawings the cockpit is made of. Ink on paper: one colour, thin marks, a
// hairline to stand on. Nothing here is a gauge or a tile.
//
//   DayColumns   one value per day (or week), as thin columns on a baseline. A day on
//                which nothing was said is simply empty: no hole, no mark.
//   RankedBars   a few named things by how often they came up, most first.
//
// Every value is also there without looking: tapping (or the arrow keys) reads one
// column out in words under the drawing, and a screen reader gets the whole list.

import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cx } from './cx'

interface ColumnsProps {
  /** What is drawn, in a few words: "Desire, the last 30 days". */
  label: string
  /** Oldest first. Null: nothing was said then. */
  values: readonly (number | null)[]
  /** The value that fills the height. */
  max: number
  /** True when 0 is a real answer ("not at all") and gets a mark of its own. */
  zeroIsAnswer?: boolean
  /** One of `values` in words: "Tuesday 10 November: on fire". Called only for values that are there. */
  describe: (index: number, value: number) => string
  /** What to say for a column without a value. */
  emptyWords: (index: number) => string
  /** Small words under the two ends of the baseline. */
  from: string
  to: string
  /** Who or what the row is, shown on the left of small multiples. */
  lead?: ReactNode
  height?: number
}

/** A period at a glance: thin columns on a hairline. Tap or use the arrow keys to read one out. */
export function DayColumns({ label, values, max, zeroIsAnswer = false, describe, emptyWords, from, to, lead, height = 44 }: ColumnsProps) {
  const [picked, setPicked] = useState<number | null>(null)
  const readout = useId()
  const count = values.length
  // Thin marks: never wider than 14, never filling the slot.
  const slot = 100 / count
  const width = Math.min(slot * 0.62, (14 / 300) * 100)
  const said = values.filter((v) => v !== null).length

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const index = Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count)))
    setPicked(index)
  }
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setPicked((was) => Math.min(count - 1, Math.max(0, (was ?? (event.key === 'ArrowLeft' ? count : -1)) + (event.key === 'ArrowLeft' ? -1 : 1))))
  }
  const words = (index: number) => (values[index] === null ? emptyWords(index) : describe(index, values[index] as number))

  return (
    <div className="flex items-end gap-3">
      {lead && <div className="shrink-0 pb-5">{lead}</div>}
      <div className="min-w-0 flex-1">
        <div
          role="group"
          aria-label={label}
          aria-describedby={readout}
          tabIndex={0}
          onPointerDown={pick}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse' || event.buttons > 0) pick(event)
          }}
          onKeyDown={step}
          className="relative touch-pan-y select-none rounded-md"
          style={{ height: height + 6 }}
        >
          <svg viewBox={`0 0 100 ${height + 6}`} preserveAspectRatio="none" width="100%" height={height + 6} aria-hidden className="block overflow-visible">
            {values.map((value, index) => {
              if (value === null) return null
              const x = index * slot + (slot - width) / 2
              const on = picked === index
              if (value === 0 && zeroIsAnswer) {
                // "Not at all" is an answer: a small mark on the line, unlike a day nothing was said on.
                return <rect key={index} x={x} y={height - 2} width={width} height={2} rx={0.6} className={on ? 'fill-ink' : 'fill-accent'} />
              }
              const h = Math.max(3, (Math.min(value, max) / max) * (height - 2))
              return <rect key={index} x={x} y={height - h} width={width} height={h} rx={Math.min(width / 2, 1.2)} className={on ? 'fill-ink' : 'fill-accent'} />
            })}
            {/* The line everything stands on. */}
            <line x1="0" x2="100" y1={height + 0.5} y2={height + 0.5} className="stroke-line-strong" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {picked !== null && <line x1={picked * slot + slot / 2} x2={picked * slot + slot / 2} y1={height + 1} y2={height + 6} className="stroke-ink" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
          </svg>
        </div>
        <div className="mt-1 flex justify-between gap-3 text-2xs font-semibold text-ink-soft">
          <span>{from}</span>
          <span className="text-right">{to}</span>
        </div>
        <p id={readout} aria-live="polite" className={cx('mt-1 min-h-5 text-xs font-semibold', picked === null && 'text-ink-soft')}>
          {picked === null ? '' : words(picked)}
        </p>
        {/* The same, as a list, for whoever does not look at the drawing. */}
        {said > 0 && (
          <ul className="sr-only">
            {values.map((value, index) => (value === null ? null : <li key={index}>{describe(index, value)}</li>))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface BarsProps {
  /** What is counted, for screen readers. */
  label: string
  rows: readonly { id: string; name: string; value: number; /** "on 5 days" */ words: string }[]
}

/** A few named things by how often they came up. One colour, the number at the end of the bar. */
export function RankedBars({ label, rows }: BarsProps) {
  const most = Math.max(1, ...rows.map((row) => row.value))
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-sm font-semibold leading-snug">{row.name}</span>
            <span className="tabular shrink-0 text-xs font-semibold text-ink-soft">{row.words}</span>
          </div>
          <div className="mt-1 h-1.5" aria-hidden>
            <div className="h-full rounded-r-full bg-accent" style={{ width: `${Math.max(3, (row.value / most) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
