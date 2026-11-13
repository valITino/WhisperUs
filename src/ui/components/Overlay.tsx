import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { pushLayer } from '../../app/router'
import { createPortal } from 'react-dom'
import { useT } from '../../i18n'
import { Icon } from '../deco/Icon'
import { buzz, cx } from './cx'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Stays visible under the scrolling content, for the main button. */
  footer?: ReactNode
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A bottom sheet. Drag the handle down, tap outside, press Escape or go back to close.
 * While it is open the keyboard stays inside it; when it closes, focus goes back to
 * whatever opened it.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const controls = useDragControls()
  const t = useT()
  const close = useRef(onClose)
  close.current = onClose
  const frame = useRef<HTMLDivElement>(null)
  /** What had focus when the sheet opened. Kept in a ref, so it survives the effect running twice in development. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    if (active instanceof HTMLElement && !frame.current?.contains(active)) opener.current = active
    // Start inside the sheet, unless something in it has asked for focus already (a search field).
    if (frame.current && !frame.current.contains(active)) frame.current.focus({ preventScroll: true })

    /** Only the sheet on top answers the keyboard when one sheet lies on another. */
    const onTop = () => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      return dialogs[dialogs.length - 1] === frame.current
    }
    const onKey = (e: KeyboardEvent) => {
      if (!frame.current || !onTop()) return
      if (e.key === 'Escape') return close.current()
      if (e.key !== 'Tab') return
      // Tab goes round inside the sheet instead of wandering off to the page underneath.
      const stops = [...frame.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (stops.length === 0) return e.preventDefault()
      const [first, last] = [stops[0], stops[stops.length - 1]]
      const at = document.activeElement
      const inside = frame.current.contains(at) && at !== frame.current
      if (e.shiftKey && (!inside || at === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || at === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    // Android's back button (or swipe) closes the sheet instead of leaving the page under it.
    const release = pushLayer(() => close.current())
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      release()
      // Back to where the person was, if that is still on the page and nothing else took focus meanwhile.
      const lost = !document.activeElement || document.activeElement === document.body || Boolean(frame.current?.contains(document.activeElement))
      if (opener.current?.isConnected && lost) opener.current.focus({ preventScroll: true })
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div ref={frame} tabIndex={-1} className="fixed inset-0 z-50 flex items-end justify-center outline-none" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div
            className="absolute inset-0 bg-[#2a1f24]/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="app-column relative flex max-h-[90dvh] flex-col overflow-hidden rounded-t-sheet bg-ground shadow-float"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose()
            }}
          >
            <div className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5" onPointerDown={(e) => controls.start(e)}>
              <span className="h-1.5 w-11 rounded-full bg-line-strong" aria-hidden />
            </div>
            {title && (
              <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-1">
                <h2 className="text-xl">{title}</h2>
                <IconButton icon="close" label={t.common.close} onClick={onClose} />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-3">{children}</div>
            {footer && <div className="shrink-0 border-t border-line bg-ground px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

interface IconButtonProps {
  icon: Parameters<typeof Icon>[0]['name']
  /** Read aloud by screen readers. Required: the button has no visible text. */
  label: string
  onClick?: () => void
  tone?: 'plain' | 'paper'
  className?: string
  disabled?: boolean
}

export function IconButton({ icon, label, onClick, tone = 'plain', className, disabled }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid size-11 shrink-0 place-items-center rounded-full text-ink transition-transform duration-100 active:scale-90 disabled:opacity-40',
        tone === 'paper' && 'border-[1.5px] border-line-strong bg-surface',
        className,
      )}
    >
      <Icon name={icon} size={22} />
    </button>
  )
}

// ------------------------------------------------------------------ toasts --

interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'oops'
}

let toasts: ToastItem[] = []
const toastListeners = new Set<() => void>()
const emit = () => toastListeners.forEach((fn) => fn())

/** A short confirmation at the bottom of the screen. It names what just happened: "Saved", "Planned for Thursday". */
export function toast(message: string, tone: 'ok' | 'oops' = 'ok'): void {
  const id = Date.now() + Math.random()
  toasts = [...toasts.slice(-2), { id, message, tone }]
  emit()
  if (tone === 'oops') buzz([20, 40, 20])
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 3200)
}

/** Mount once, near the root. */
export function Toaster() {
  const items = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn)
      return () => toastListeners.delete(fn)
    },
    () => toasts,
  )
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ y: 24, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={cx(
              'flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 text-sm font-extrabold shadow-float',
              item.tone === 'ok' ? 'bg-ink text-ground' : 'bg-wax text-on-wax',
            )}
          >
            <Icon name={item.tone === 'ok' ? 'check' : 'close'} size={18} />
            {item.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
