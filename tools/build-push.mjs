// Bundles the push function (supabase/functions/push) into ONE plain file for deploying
// through a connector that takes pasted text: supabase/functions/push/dist/index.js.
// Readable on purpose: not minified, nothing imported, comments dropped, no backslashes.
// Prints its size and SHA-256, so a pasted copy can be checked against it.
// Run with: npm run build:push

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'supabase/functions/push/dist/index.js')

await build({
  entryPoints: [join(root, 'supabase/functions/push/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  target: 'esnext',
  platform: 'neutral',
  minify: false,
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
})

// Easier to copy by hand or by paste: no bundler annotations, nothing to escape.
const plain = readFileSync(outfile, 'utf8').replaceAll('/* @__PURE__ */ ', '')
if (/^\s*(import|export)\s/m.test(plain)) throw new Error('The bundle still imports or exports something. It has to stand alone.')
if (plain.includes('\\')) throw new Error('The bundle contains a backslash. Pasting it through a connector could break it: write that line another way.')
writeFileSync(outfile, plain)

const bytes = Buffer.from(plain, 'utf8')
const letters = [...new Set(plain.match(/[^\x00-\x7F]/g) ?? [])].join(' ')
console.log(relative(root, outfile))
console.log(`size    ${bytes.length} bytes, ${plain.length} characters, ${plain.split('\n').length - 1} lines`)
console.log(`beyond plain ASCII: ${letters || 'nothing'}`)
console.log(`sha256  ${createHash('sha256').update(bytes).digest('hex')}`)
