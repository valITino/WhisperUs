// "A new version is ready": a small note that floats above the page until the person
// taps "Reload" or puts it off. The app never reloads by itself. Mounted once, in main.tsx.

import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { useCopy } from '../i18n'
import { Button, IconButton } from '../ui/components'
import { dismissUpdate, reloadIntoUpdate, useUpdateReady } from './update'

const copy = {
  en: { ready: 'A new version is ready.', reload: 'Reload', later: 'Later' },
  de: { ready: 'Eine neue Version ist da.', reload: 'Neu laden', later: 'Später' },
}

export function UpdateNote() {
  const c = useCopy(copy)
  const ready = useUpdateReady()
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {ready && (
          // Above the tab bar and its raised button, below sheets: a sheet in use is never covered.
          <div className="pointer-events-none fixed inset-x-0 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[45] px-4">
            <motion.div
              role="status"
              data-testid="update-note"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 12, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              className="app-column pointer-events-auto flex items-center gap-2 rounded-card border border-line bg-surface py-2 pl-4 pr-1.5 shadow-float"
            >
              <p className="min-w-0 flex-1 text-sm font-bold leading-snug">{c.ready}</p>
              <Button variant="secondary" className="shrink-0" onClick={reloadIntoUpdate}>
                {c.reload}
              </Button>
              <IconButton icon="close" label={c.later} onClick={dismissUpdate} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
