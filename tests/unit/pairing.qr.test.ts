import { describe, expect, it } from 'vitest'
import { finderCorners, inLogo, logoModules, modulesPath, qrMatrix } from '../../src/features/onboarding/qr'

const LINKS = [
  'http://127.0.0.1:5173/#/join/ABCDEFGHJK',
  'https://valitino.github.io/WhisperUs/#/join/ABCDEFGHJK',
  'https://valitino.github.io/WhisperUs/#/join?code=ABCDEFGHJK',
]

/** The 7 x 7 corner square every QR code carries three times. */
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111']

describe('the invite QR code', () => {
  it('has a valid size and the three corner squares for every kind of link', () => {
    for (const link of LINKS) {
      const { size, dark } = qrMatrix(link)
      expect((size - 17) % 4).toBe(0)
      expect(dark).toHaveLength(size)
      for (const [x, y] of finderCorners(size)) {
        const found = FINDER.map((_, row) => dark[y + row].slice(x, x + 7).map((d) => (d ? '1' : '0')).join(''))
        expect(found).toEqual(FINDER)
      }
    }
  })

  it('keeps the space for the seal small enough for the code to repair itself', () => {
    for (const link of LINKS) {
      const { size } = qrMatrix(link)
      const hole = logoModules(size)
      expect(hole % 2).toBe(1)
      // Level H repairs about 30%. The mascot covers under 6%.
      expect((hole * hole) / (size * size)).toBeLessThan(0.06)
      const middle = (size - 1) / 2
      expect(inLogo(size, middle, middle)).toBe(true)
      expect(inLogo(size, 0, 0)).toBe(false)
      expect(finderCorners(size).some(([x, y]) => inLogo(size, x, y))).toBe(false)
    }
  })

  it('draws one rounded module for every dark module outside the corner squares and the middle', () => {
    const matrix = qrMatrix(LINKS[1])
    const { size, dark } = matrix
    const inFinder = (col: number, row: number) => finderCorners(size).some(([x, y]) => col >= x && col < x + 7 && row >= y && row < y + 7)
    let all = 0
    let outsideLogo = 0
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!dark[row][col] || inFinder(col, row)) continue
        all += 1
        if (!inLogo(size, col, row)) outsideLogo += 1
      }
    }
    const count = (path: string) => path.split('M').length - 1
    expect(count(modulesPath(matrix))).toBe(all)
    expect(count(modulesPath(matrix, { logo: true }))).toBe(outsideLogo)
    expect(outsideLogo).toBeLessThan(all)
    // No runaway decimals in the path.
    expect(modulesPath(matrix, { logo: true })).not.toMatch(/\d\.\d{4}/)
  })

  it('gives the same picture for the same link', () => {
    expect(modulesPath(qrMatrix(LINKS[0]))).toBe(modulesPath(qrMatrix(LINKS[0])))
    expect(modulesPath(qrMatrix(LINKS[0]))).not.toBe(modulesPath(qrMatrix(LINKS[1])))
  })
})
