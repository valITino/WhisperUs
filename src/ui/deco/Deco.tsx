// The drawn things of WhisperUs: the envelope, its wax seal, a candle, flames for heat,
// and the signs people pick for their avatar. Cut paper and wax: flat shapes, one darker
// shade for depth, no outlines. Their colours are fixed (the --color-art-* tokens), so a
// cream envelope is cream by day and after dark.

import type { CSSProperties, ReactNode } from 'react'

export interface ArtProps {
  size?: number
  className?: string
  /** Read out by screen readers. Without it the drawing is decoration. */
  label?: string
  style?: CSSProperties
}

const PAPER = 'var(--color-art-paper)'
const PAPER_SHADE = 'var(--color-art-paper-shade)'
const WAX = 'var(--color-art-wax)'
const WAX_DEEP = 'var(--color-art-wax-deep)'
const WAX_LIGHT = 'var(--color-art-wax-light)'
const CANDLE = 'var(--color-art-candle)'
const FLAME = 'var(--color-art-flame)'
const PLUM = 'var(--color-art-plum)'
const INK = 'var(--color-art-outline)'

function Art({ size = 48, width, viewBox, className, label, style, children }: ArtProps & { width?: number; viewBox: string; children: ReactNode }) {
  return (
    <svg
      width={width ?? size}
      height={size}
      viewBox={viewBox}
      fill="none"
      className={className}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  )
}

// ---------------------------------------------------------------- the seal --

/** A closed, smooth shape through points on a wobbly circle: pressed wax is never round. */
function blob(cx: number, cy: number, radii: readonly number[]): string {
  const points = radii.map((r, i) => {
    const angle = (i / radii.length) * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const
  })
  const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const
  const f = (n: number) => n.toFixed(2)
  const start = mid(points[points.length - 1], points[0])
  let d = `M${f(start[0])} ${f(start[1])}`
  points.forEach((point, i) => {
    const next = mid(point, points[(i + 1) % points.length])
    d += `Q${f(point[0])} ${f(point[1])} ${f(next[0])} ${f(next[1])}`
  })
  return `${d}Z`
}

const SEAL_EDGE = blob(32, 32, [29, 30.5, 27.5, 30, 28.5, 30.5, 27, 29.5, 30.5, 28, 30, 27.5, 29.5, 30.5, 28, 30])
const KEYHOLE = 'M32 22.5a5.4 5.4 0 0 1 3.1 9.8l2.1 9.2h-10.4l2.1-9.2A5.4 5.4 0 0 1 32 22.5Z'

/** What a seal is pressed with. keyhole: sealed, something is inside. heart: an answer. */
export type SealMark = 'keyhole' | 'heart' | 'none'

/**
 * A wax seal. `broken` shows it cracked in two: the envelope has been opened.
 * Inside an <svg> use SealShape instead.
 */
export function WaxSeal({ mark = 'keyhole', broken = false, ...p }: ArtProps & { mark?: SealMark; broken?: boolean }) {
  return (
    <Art viewBox="0 0 64 64" {...p}>
      <SealShape mark={mark} broken={broken} />
    </Art>
  )
}

/** The seal's shapes, in a 64 x 64 box, for composing into other drawings. */
export function SealShape({ mark = 'keyhole', broken = false }: { mark?: SealMark; broken?: boolean }) {
  const face = (
    <>
      <path d={SEAL_EDGE} fill={WAX} />
      <circle cx="32" cy="32" r="19.5" fill={WAX_DEEP} opacity=".55" />
      <circle cx="32" cy="32" r="17.5" fill={WAX} />
      {/* Light catching the rim, top left. */}
      <path d="M13 24c2.5-6 7-10.5 13-12.5" stroke={WAX_LIGHT} strokeWidth="2.6" strokeLinecap="round" opacity=".85" />
      {mark === 'keyhole' && <path d={KEYHOLE} fill={WAX_DEEP} />}
      {mark === 'heart' && <path d="M32 41c-6.5-4.6-9-8-8.4-11.2.5-2.9 3-4.3 5.3-3.8 1.4.3 2.5 1.2 3.1 2.4.6-1.2 1.7-2.1 3.1-2.4 2.3-.5 4.8.9 5.3 3.8C41 33 38.5 36.4 32 41Z" fill={WAX_DEEP} />}
    </>
  )
  if (!broken) return face
  // Two halves, pushed apart along a crack.
  return (
    <>
      <g clipPath="url(#seal-left)" transform="translate(-2.5 1) rotate(-5 32 32)">
        {face}
      </g>
      <g clipPath="url(#seal-right)" transform="translate(2.5 -1) rotate(5 32 32)">
        {face}
      </g>
      <defs>
        <clipPath id="seal-left">
          <path d="M0 0h30l4 14-5 9 6 10-5 11 3 20H0Z" />
        </clipPath>
        <clipPath id="seal-right">
          <path d="M64 0H30l4 14-5 9 6 10-5 11 3 20h31Z" />
        </clipPath>
      </defs>
    </>
  )
}

// ------------------------------------------------------------ the envelope --

/**
 * An envelope from the back, where the flap is. sealed: closed, the seal on the point of
 * the flap. open: the flap is up and a sheet shows. `size` is its height; it is 10 : 7.
 */
export function Envelope({ state = 'sealed', mark = 'keyhole', size = 84, ...p }: ArtProps & { state?: 'sealed' | 'open'; mark?: SealMark }) {
  const open = state === 'open'
  return (
    <Art viewBox="0 0 120 96" size={size} width={(size * 120) / 96} {...p}>
      {open && (
        <>
          {/* The flap, up. */}
          <path d="M6 30 60 2l54 28Z" fill={PAPER_SHADE} />
          {/* The sheet, half out. */}
          <rect x="18" y="12" width="84" height="56" rx="3" fill="#fffaf2" />
          <path d="M30 26h44M30 35h60M30 44h52" stroke={PLUM} strokeWidth="2.4" strokeLinecap="round" opacity=".35" />
        </>
      )}
      <rect x="6" y="28" width="108" height="64" rx="5" fill={PAPER} />
      {/* The side and bottom folds. */}
      <path d="M6 92 48 60M114 92 72 60" stroke={PAPER_SHADE} strokeWidth="2.2" strokeLinecap="round" />
      {open ? (
        <path d="M6 31 60 66l54-35" stroke={PAPER_SHADE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <path d="M8.5 29.5 60 64l51.5-34.5A5 5 0 0 0 109 28H11a5 5 0 0 0-2.5 1.5Z" fill={PAPER_SHADE} />
          <path d="M7 31 60 66l53-35" stroke={PAPER_SHADE} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {mark !== 'none' && (
            <g transform="translate(41 45) scale(.6)">
              <SealShape mark={mark} />
            </g>
          )}
        </>
      )}
    </Art>
  )
}

// ------------------------------------------------------- flame and candle --

const FLAME_OUTER = 'M24 3c1.5 7.5 11 12.5 11 23.5C35 34 30.2 40 24 40s-11-6-11-13.5c0-5 3-8 5-12 .8 2.7 2 4.2 3.5 5C21 13.5 21.5 8 24 3Z'
const FLAME_INNER = 'M24 21c.8 3.5 5 5.5 5 10.5 0 3.3-2.2 6-5 6s-5-2.7-5-6c0-2.2 1.2-3.7 2.2-5.5.5 1.2 1 1.9 1.8 2.3-.3-2.6 0-5 1-7.3Z'

/** One flame: the unit of heat. `on` false draws only its outline. */
export function Flame({ on = true, ...p }: ArtProps & { on?: boolean }) {
  return (
    <Art viewBox="0 0 48 44" {...p}>
      {on ? (
        <>
          <path d={FLAME_OUTER} fill={CANDLE} />
          <path d={FLAME_INNER} fill={FLAME} />
        </>
      ) : (
        <path d={FLAME_OUTER} stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" opacity=".45" />
      )}
    </Art>
  )
}

/** A candle in its dish. Lit, its flame breathes; out, a thread of smoke rises. */
export function Candle({ lit = true, ...p }: ArtProps & { lit?: boolean }) {
  return (
    <Art viewBox="0 0 64 80" size={p.size ?? 64} width={((p.size ?? 64) * 64) / 80} className={p.className} label={p.label} style={p.style}>
      {lit ? (
        <g style={{ transformOrigin: '32px 30px', animation: 'flicker 2.6s ease-in-out infinite' }}>
          <path d="M32 6c1 5.5 7.5 9 7.5 16.5 0 5-3.3 9-7.5 9s-7.5-4-7.5-9c0-3.5 2-5.5 3.4-8.3.6 1.9 1.4 2.9 2.4 3.5C29.9 13.5 30.3 9.5 32 6Z" fill={CANDLE} />
          <path d="M32 18.5c.5 2.3 3.4 3.7 3.4 7 0 2.2-1.5 4-3.4 4s-3.4-1.8-3.4-4c0-1.5.8-2.5 1.5-3.7.3.8.7 1.3 1.2 1.6-.2-1.8 0-3.4.7-4.9Z" fill={FLAME} />
        </g>
      ) : (
        <path d="M32 31c-3-4 3-6 0-10s3-6 .5-10" stroke={PLUM} strokeWidth="2.2" strokeLinecap="round" opacity=".5" />
      )}
      <path d="M32 31v6" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <rect x="22" y="36" width="20" height="30" rx="3.5" fill={PAPER} />
      {/* A run of wax down the side. */}
      <path d="M22 39.5A3.5 3.5 0 0 1 25.5 36H34c0 3-1.2 4.5-3 4.5s-1.5 6-3.5 6-1.5-4-3-4-2.5 1.5-2.5 4Z" fill={PAPER_SHADE} />
      <path d="M11 66h42a4 4 0 0 1-4 4.5H15a4 4 0 0 1-4-4.5Z" fill={PLUM} />
      <rect x="27" y="70" width="10" height="5" rx="2" fill={PLUM} />
    </Art>
  )
}

// ----------------------------------------------------------- avatar signs --

const STAR = 'M24 4c2 13 5 16 18 20-13 4-16 7-18 20-2-13-5-16-18-20 13-4 16-7 18-20Z'

export function Moon(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M31 5.5A19 19 0 1 0 42.5 34 15.5 15.5 0 0 1 31 5.5Z" fill={FLAME} />
      <path d={STAR} transform="translate(36 13) scale(.2) translate(-24 -24)" fill={CANDLE} />
    </Art>
  )
}

export function Sun(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M24 3.5v6M24 38.5v6M3.5 24h6M38.5 24h6M9.5 9.5l4.2 4.2M34.3 34.3l4.2 4.2M9.5 38.5l4.2-4.2M34.3 13.7l4.2-4.2" stroke={CANDLE} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24" cy="24" r="10.5" fill={CANDLE} />
      <circle cx="24" cy="24" r="6" fill={FLAME} />
    </Art>
  )
}

export function Key(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <g transform="rotate(-38 24 24)">
        <path d="M22 20h4v22h-4z" fill={CANDLE} />
        <path d="M26 31h6v4h-6zM26 37.5h4.5v4H26z" fill={CANDLE} />
        <circle cx="24" cy="13" r="9.5" fill={CANDLE} />
        <circle cx="24" cy="12" r="3.8" fill={PLUM} opacity=".55" />
      </g>
    </Art>
  )
}

export function Cat(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M8 9.5 17.5 16a15 15 0 0 1 13 0L40 9.5l-1.5 14.5c.3 1.2.5 2.4.5 3.7C39 35.7 32.3 41 24 41S9 35.7 9 27.7c0-1.3.2-2.5.5-3.7L8 9.5Z" fill={PLUM} />
      <ellipse cx="18" cy="26.5" rx="2.3" ry="3" fill={FLAME} />
      <ellipse cx="30" cy="26.5" rx="2.3" ry="3" fill={FLAME} />
      <path d="M22.3 32.2h3.4L24 34.2Z" fill={WAX_LIGHT} />
    </Art>
  )
}

export function Cherries(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M15.5 30C16 20 22 11.5 32.5 6.5c1 9-1 17 1 24.5" stroke="#5f7a4c" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="33.5" r="9" fill={WAX} />
      <circle cx="33.5" cy="35" r="9" fill={WAX} />
      <path d="M9.5 31c.5-2 2-3.5 4-4M28.5 32.5c.5-2 2-3.5 4-4" stroke={WAX_LIGHT} strokeWidth="2.2" strokeLinecap="round" />
    </Art>
  )
}

export function Peach(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M24 12.5c7-4.5 17 0 17 11.5 0 9.5-7.5 18-17 18S7 33.5 7 24c0-11.5 10-16 17-11.5Z" fill="#f4a988" />
      <path d="M24 12.5c-4.5 6.5-4.5 20 1 28.5" stroke="#d97f66" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 12.5c0-4 3-7.5 8.5-7.5 0 4.5-3.5 7.5-8.5 7.5Z" fill="#7f9a68" />
    </Art>
  )
}

export function Mask(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M4 17c6-2.5 13-2 20 3 7-5 14-5.5 20-3 0 9.5-4.5 16-11.5 16-4 0-6.5-2.5-8.5-5.5-2 3-4.5 5.5-8.5 5.5C8.5 33 4 26.5 4 17Z" fill={PLUM} />
      <path d="M11 21.5c3-1.5 6.5-1 9 1.5-2 3-6.5 3.5-9-1.5ZM37 21.5c-3-1.5-6.5-1-9 1.5 2 3 6.5 3.5 9-1.5Z" fill={FLAME} />
      <path d={STAR} transform="translate(41 12) scale(.18) translate(-24 -24)" fill={CANDLE} />
    </Art>
  )
}

export function FlameSign(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <g transform="translate(0 3)">
        <path d={FLAME_OUTER} fill={CANDLE} />
        <path d={FLAME_INNER} fill={FLAME} />
      </g>
    </Art>
  )
}

// ------------------------------------------------------------- accessories --

export function Bow({ fill = WAX, ...p }: ArtProps & { fill?: string }) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M24 24C17 14.5 8 13 5 16.5c-2.5 3-2 12 0 15C8 35 17 33.5 24 24Z" fill={fill} />
      <path d="M24 24c7-9.5 16-11 19-7.5 2.5 3 2 12 0 15C40 35 31 33.5 24 24Z" fill={fill} />
      <rect x="19.5" y="19" width="9" height="10" rx="3.5" fill={WAX_DEEP} />
    </Art>
  )
}

export function Crown(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M9.5 35 6.5 17l9.5 7.5L24 11l8 13.5L41.5 17l-3 18h-29Z" fill={CANDLE} />
      <rect x="8.5" y="34" width="31" height="7" rx="2.5" fill="var(--color-candle-edge)" />
      <circle cx="24" cy="9.5" r="3" fill={WAX} />
      <circle cx="6.5" cy="15.5" r="2.6" fill={WAX_LIGHT} />
      <circle cx="41.5" cy="15.5" r="2.6" fill={WAX_LIGHT} />
    </Art>
  )
}

export function Halo(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <ellipse cx="24" cy="24" rx="18" ry="7.5" stroke={CANDLE} strokeWidth="5" />
      <path d="M9 21c3-2.5 8-4 13-4.3" stroke={FLAME} strokeWidth="2.2" strokeLinecap="round" />
    </Art>
  )
}

export function Horns(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d="M5 8c-1 12 3 22 13 27l3-8C13.5 24 8.5 17 5 8Z" fill={WAX} />
      <path d="M43 8c1 12-3 22-13 27l-3-8c7.5-3 12.5-10 16-19Z" fill={WAX} />
      <path d="M7.5 14c.5 5 2.5 9.5 6 13M40.5 14c-.5 5-2.5 9.5-6 13" stroke={WAX_LIGHT} strokeWidth="2" strokeLinecap="round" opacity=".8" />
    </Art>
  )
}

/** Two sparkles, one big and one small. */
export function Sparkle(p: ArtProps) {
  return (
    <Art viewBox="0 0 48 48" {...p}>
      <path d={STAR} transform="translate(20 28) scale(.74) translate(-24 -24)" fill={CANDLE} />
      <path d={STAR} transform="translate(38 11) scale(.36) translate(-24 -24)" fill={FLAME} />
    </Art>
  )
}
