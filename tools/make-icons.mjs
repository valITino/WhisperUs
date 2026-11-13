// Builds the brand files and app icons from one source of truth: the wax seal.
// Run with: npm run icons
//
// The seal is drawn the same way as SealShape in src/ui/deco/Deco.tsx (a wobbly circle, a
// rim, a keyhole). Change one and you change the other.
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const NIGHT = '#1b1220'
const WAX = '#b3283c'
const WAX_DEEP = '#861a2b'
const WAX_LIGHT = '#d4566a'

/** A closed, smooth shape through points on a wobbly circle: pressed wax is never round. */
function blob(cx, cy, radii) {
  const points = radii.map((r, i) => {
    const angle = (i / radii.length) * Math.PI * 2 - Math.PI / 2
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
  })
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const f = (n) => n.toFixed(2)
  const start = mid(points[points.length - 1], points[0])
  let d = `M${f(start[0])} ${f(start[1])}`
  points.forEach((point, i) => {
    const next = mid(point, points[(i + 1) % points.length])
    d += `Q${f(point[0])} ${f(point[1])} ${f(next[0])} ${f(next[1])}`
  })
  return `${d}Z`
}

const EDGE = blob(32, 32, [29, 30.5, 27.5, 30, 28.5, 30.5, 27, 29.5, 30.5, 28, 30, 27.5, 29.5, 30.5, 28, 30])
const KEYHOLE = 'M32 22.5a5.4 5.4 0 0 1 3.1 9.8l2.1 9.2h-10.4l2.1-9.2A5.4 5.4 0 0 1 32 22.5Z'

/** The seal on a 64 x 64 canvas. */
const seal = `
  <path d="${EDGE}" fill="${WAX}"/>
  <circle cx="32" cy="32" r="19.5" fill="${WAX_DEEP}" opacity=".55"/>
  <circle cx="32" cy="32" r="17.5" fill="${WAX}"/>
  <path d="M13 24c2.5-6 7-10.5 13-12.5" fill="none" stroke="${WAX_LIGHT}" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
  <path d="${KEYHOLE}" fill="${WAX_DEEP}"/>
`

const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">${seal}</svg>`

/** Square app icon. "bleed" fills the whole square (Android crops it to its own shape). */
const icon = ({ bleed }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${bleed ? 0 : 116}" fill="${NIGHT}"/>
  <g transform="translate(${bleed ? 112 : 80} ${bleed ? 112 : 80}) scale(${bleed ? 4.5 : 5.5})">${seal}</g>
</svg>`

/**
 * The small one-colour icon Android shows in the status bar next to a notification:
 * the seal's outline with its keyhole cut out, white on nothing. Android tints it itself.
 */
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="96" height="96">
  <defs>
    <mask id="cut">
      <rect width="64" height="64" fill="#fff"/>
      <path d="${KEYHOLE}" transform="translate(32 32) scale(1.25) translate(-32 -32)" fill="#000"/>
    </mask>
  </defs>
  <path d="${EDGE}" fill="#fff" mask="url(#cut)"/>
</svg>`

await mkdir('brand', { recursive: true })
await mkdir('public/icons', { recursive: true })
await writeFile('brand/whisperus-mark.svg', mark)
await writeFile('brand/whisperus-icon.svg', icon({ bleed: false }))
await writeFile('public/icons/icon.svg', icon({ bleed: false }))

const rounded = Buffer.from(icon({ bleed: false }))
const full = Buffer.from(icon({ bleed: true }))
await sharp(rounded).resize(192, 192).png().toFile('public/icons/icon-192.png')
await sharp(rounded).resize(512, 512).png().toFile('public/icons/icon-512.png')
await sharp(full).resize(512, 512).png().toFile('public/icons/maskable-512.png')
await sharp(full).resize(192, 192).png().toFile('public/icons/maskable-192.png')
await sharp(Buffer.from(badge)).resize(96, 96).png().toFile('public/icons/badge-96.png')
await sharp(Buffer.from(mark)).resize(800).png().toFile('brand/whisperus-mark.png')
console.log('Icons written to public/icons and brand/')
