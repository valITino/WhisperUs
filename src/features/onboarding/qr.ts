// The module matrix of a QR code and the shapes we draw it with. Pure, unit tested.
// The drawing itself (rounded ink modules on paper, the wax seal in the middle) is in QrCode.tsx.

import qrcode from 'qrcode-generator'

export interface QrMatrix {
  /** Modules per side. */
  size: number
  /** dark[row][column] */
  dark: boolean[][]
}

/**
 * Error correction "H" lets a reader rebuild up to about 30% of the code, which is what
 * makes room for the mascot in the middle.
 */
export function qrMatrix(text: string, level: 'L' | 'M' | 'Q' | 'H' = 'H'): QrMatrix {
  const qr = qrcode(0, level)
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  const dark = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)))
  return { size, dark }
}

/** Top-left corners (column, row) of the three big corner squares. */
export function finderCorners(size: number): [number, number][] {
  return [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ]
}

const inFinder = (size: number, col: number, row: number) => finderCorners(size).some(([x, y]) => col >= x && col < x + 7 && row >= y && row < y + 7)

/**
 * How many modules (per side) the picture in the middle may cover. Always odd, so it
 * sits exactly centred, and small enough to stay far inside what "H" can repair:
 * under 6% of the code's area.
 */
export function logoModules(size: number): number {
  const wanted = Math.floor(size * 0.24)
  return wanted % 2 === 1 ? wanted : wanted - 1
}

export function inLogo(size: number, col: number, row: number): boolean {
  const hole = logoModules(size)
  const from = (size - hole) / 2
  return col >= from && col < from + hole && row >= from && row < from + hole
}

/**
 * One SVG path with a small rounded square for every dark module, leaving out the corner
 * squares (drawn separately, as rounded rings) and, if asked, the middle.
 * Coordinates are in modules: the viewBox is "0 0 size size".
 */
export function modulesPath({ size, dark }: QrMatrix, options: { logo?: boolean } = {}): string {
  const side = 0.92
  const inset = (1 - side) / 2
  const r = 0.3
  const straight = +(side - 2 * r).toFixed(2)
  let d = ''
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!dark[row][col] || inFinder(size, col, row)) continue
      if (options.logo && inLogo(size, col, row)) continue
      const x = +(col + inset + r).toFixed(2)
      const y = +(row + inset).toFixed(2)
      d += `M${x} ${y}h${straight}a${r} ${r} 0 0 1 ${r} ${r}v${straight}a${r} ${r} 0 0 1 -${r} ${r}h-${straight}a${r} ${r} 0 0 1 -${r} -${r}v-${straight}a${r} ${r} 0 0 1 ${r} -${r}z`
    }
  }
  return d
}
