// Small building blocks shared by the start screens and the pages in Settings.

import type { ReactNode } from 'react'
import { Button, Loader, PageHeader, Sheet } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'

interface StepPageProps {
  /** With a title the page gets the usual header with a back arrow. */
  title?: string
  backTo?: string
  children: ReactNode
  /** Stays at the bottom of the screen: the place for the main button. */
  footer?: ReactNode
}

/** A full page for one step: optional header, scrolling content, and a footer that stays in reach. */
export function StepPage({ title, backTo = '/', children, footer }: StepPageProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {title && <PageHeader title={title} backTo={backTo} />}
      <main className="app-column flex-1 pb-8 pt-5">{children}</main>
      {footer && (
        <div className="sticky bottom-0 z-30 border-t border-line bg-ground">
          <div className="app-column flex flex-col gap-2.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>
        </div>
      )}
    </div>
  )
}

/** What went wrong and what to do about it, right where it happened. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" data-testid="pairing-error" className="flex items-start gap-2.5 rounded-card border-[1.5px] border-wax bg-surface px-3.5 py-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-wax text-on-wax" aria-hidden>
        <Icon name="close" size={13} />
      </span>
      <p className="min-w-0 text-sm font-semibold leading-snug">{children}</p>
    </div>
  )
}

/** A gentle heads-up before something with consequences. */
export function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-2.5 rounded-card border-[1.5px] border-gold-ink bg-surface px-3.5 py-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gold text-xs font-extrabold text-on-candle" aria-hidden>
        !
      </span>
      <p className="min-w-0 text-sm font-semibold leading-snug">{children}</p>
    </div>
  )
}

interface ConfirmSheetProps {
  open: boolean
  title: string
  /** What will happen, in plain words. */
  children: ReactNode
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onClose: () => void
  /** True while the confirmed action is running. */
  busy?: boolean
}

/** "Are you sure?" as a bottom sheet: says what happens, one button to do it, one to back out. */
export function ConfirmSheet({ open, title, children, confirmLabel, cancelLabel, onConfirm, onClose, busy = false }: ConfirmSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-1.5">
          <Button block size="lg" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="quiet" block onClick={onClose}>
            {cancelLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 pb-1 text-sm leading-relaxed text-ink-soft">{children}</div>
    </Sheet>
  )
}

/** The whole screen while the cloud is busy with a pairing call. */
export function BusyScreen({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-ground px-6">
      <Loader label={label} />
    </div>
  )
}

/** Put text on the clipboard. Resolves false when the phone would not let us. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* older browsers and pages without permission: try the classic way */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
