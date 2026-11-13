// A QR code in our own hand: rounded ink modules on paper, with the wax seal in the middle.
// It is always dark on light, also after dark, because that is what cameras read best.

import { useMemo } from 'react'
import { WaxSeal } from '../../ui/deco/Deco'
import { finderCorners, logoModules, modulesPath, qrMatrix } from './qr'

const COCOA = '#2c1b33'
const PAPER = '#fdfafc'
/**
 * The three corner squares, in modules. Readers find a code by these, and measured with
 * OpenCV's two readers on deliberately bad photos, any rounding of the frame cost reads
 * (0.2 lost about 5%, 0.4 about 20%, fully round all of them), while round modules, a
 * round centre dot and a picture in the middle cost nothing. So: square frame, round dot.
 */
const FINDER_DOT_RADIUS = 1

interface Props {
  /** The text inside the code, for example an invite link. */
  value: string
  size?: number
  /** Read aloud instead of the picture. */
  label: string
}

export function QrCode({ value, size = 232, label }: Props) {
  const { count, path, hole } = useMemo(() => {
    const matrix = qrMatrix(value)
    return { count: matrix.size, path: modulesPath(matrix, { logo: true }), hole: logoModules(matrix.size) }
  }, [value])
  const holePx = (hole / count) * size

  return (
    <div
      role="img"
      aria-label={label}
      data-testid="qr"
      data-qr-value={value}
      className="relative"
      style={{ width: size, height: size, background: PAPER }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} aria-hidden>
        <path d={path} fill={COCOA} />
        {finderCorners(count).map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x + 0.5} y={y + 0.5} width="6" height="6" stroke={COCOA} strokeWidth="1" fill="none" />
            <rect x={x + 2} y={y + 2} width="3" height="3" rx={FINDER_DOT_RADIUS} fill={COCOA} />
          </g>
        ))}
      </svg>
      {/* The seal sits where a letter's seal would: in the middle. */}
      <span className="absolute grid place-items-center rounded-full" style={{ left: (size - holePx) / 2, top: (size - holePx) / 2, width: holePx, height: holePx, background: PAPER }} aria-hidden>
        <WaxSeal size={holePx * 0.94} />
      </span>
    </div>
  )
}
