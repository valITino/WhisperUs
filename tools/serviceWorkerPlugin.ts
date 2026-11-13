// Builds the service worker after the app itself has been built.
//
// The worker (src/sw/sw.ts) is written by hand. What it cannot know by itself is which
// files make up the app, so this plugin looks at the finished build and tells it:
//
//   1. every file in the output folder becomes part of the list (source maps and old
//      font formats stay out: no phone ever asks for them);
//   2. a fingerprint of all of them becomes the version. Same files, same version, so a
//      deploy that changes nothing shows nobody an update note;
//   3. the version is written into index.html, so a page knows which build it belongs to;
//   4. the worker is bundled into one classic script, sw.js, next to index.html.
//
// It only runs for builds. The dev server has no service worker at all.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { build, type Plugin, type ResolvedConfig } from 'vite'

/** The file the worker is built into, next to index.html. */
export const SW_FILE = 'sw.js'
/** index.html carries this until the build replaces it with the version. */
export const VERSION_PLACEHOLDER = 'content="dev"'

const SKIP = [/\.map$/, /\.woff$/, /^sw\.js$/, /(^|\/)\./]

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path, root) : [relative(root, path).split(sep).join('/')]
  })
}

/** The files the worker saves for offline use, and the version they add up to. */
export function shellOf(outDir: string): { files: string[]; version: string } {
  const files = walk(outDir)
    .filter((file) => !SKIP.some((skip) => skip.test(file)))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(join(outDir, file)))
    hash.update('\0')
  }
  return { files, version: hash.digest('hex').slice(0, 16) }
}

export function serviceWorker(): Plugin {
  let config: ResolvedConfig

  return {
    name: 'whisperus-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir)
      const { files, version } = shellOf(outDir)
      if (!files.includes('index.html')) throw new Error('Service worker: the build has no index.html to save for offline use.')

      const indexPath = join(outDir, 'index.html')
      const html = readFileSync(indexPath, 'utf8')
      if (!html.includes(VERSION_PLACEHOLDER)) throw new Error(`Service worker: index.html has no ${VERSION_PLACEHOLDER} to put the version into.`)
      writeFileSync(indexPath, html.replace(VERSION_PLACEHOLDER, `content="${version}"`))

      await build({
        configFile: false,
        envDir: false,
        root: config.root,
        publicDir: false,
        logLevel: 'warn',
        define: {
          __SW_FILES__: JSON.stringify(files),
          __SW_VERSION__: JSON.stringify(version),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          target: 'es2022',
          lib: { entry: resolve(config.root, 'src/sw/sw.ts'), formats: ['iife'], name: 'whisperusServiceWorker', fileName: () => SW_FILE },
        },
      })
      config.logger.info(`${SW_FILE}: ${files.length} files saved for offline use, version ${version}`)
    },
  }
}
