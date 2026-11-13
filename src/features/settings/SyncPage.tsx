// The Sync page: what the state means and what to do about it, the numbers, the changes
// the cloud refused (each with "Try again" and "Discard"), "Sync now", and a report to
// copy for whoever looks after the app.

import { useState } from 'react'
import { version } from '../../../package.json'
import { backend, db, sync, useSyncStatus } from '../../data/app'
import { isBackendError } from '../../data/backend'
import { META } from '../../data/db'
import { useMe } from '../../data/hooks'
import { useMembers, useRefusedChanges, useStuckUploads } from '../../data/queries'
import type { RefusedChange } from '../../data/refused'
import { SYNC_TABLES } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { formatTime, relativeDay, toDay } from '../../lib/dates'
import { Button, Card, SyncPill, toast } from '../../ui/components'
import { useTheme } from '../../ui/theme'
import { ConfirmSheet, copyText, ErrorNote, StepPage } from '../onboarding/parts'
import { settingsCopy } from './copy'
import { syncReport } from './syncReport'

function Fact({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="tabular text-right text-sm font-extrabold" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}

export function SyncPage() {
  const c = useCopy(settingsCopy)
  const t = useT()
  const lang = useLang()
  const theme = useTheme()
  const status = useSyncStatus()
  const me = useMe()
  const members = useMembers()
  const refused = useRefusedChanges()
  const stuckFiles = useStuckUploads() ?? 0
  const [working, setWorking] = useState(false)
  const [busy, setBusy] = useState<number | 'all' | 'files' | null>(null)
  const [asking, setAsking] = useState<RefusedChange | null>(null)
  const [discarding, setDiscarding] = useState(false)
  // The sheet keeps its words while it slides away.
  const [lastAsked, setLastAsked] = useState<RefusedChange | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const moment = (iso: string) => `${relativeDay(toDay(iso), lang, t.common)}, ${formatTime(iso, lang)}`
  const lastSync = status.lastSyncAt ? moment(status.lastSyncAt) : c.sync.never
  const words = (change: RefusedChange) => c.sync.thing[change.thing][change.what]

  // The one thing that matters most right now, said in full.
  let advice = c.sync.advice.allGood
  if (status.state === 'locked-out') advice = c.sync.advice.lockedOut
  else if (status.state === 'paused') advice = c.sync.advice.paused
  else if (status.state === 'offline') advice = c.sync.advice.offline
  else if (status.state === 'error') advice = c.sync.advice.error
  else if (status.stuck > 0) advice = c.sync.advice.refused(status.stuck)
  else if (status.pending + status.uploads - stuckFiles > 0) advice = c.sync.advice.waiting(status.pending + status.uploads - stuckFiles)

  const syncNow = async () => {
    setWorking(true)
    await sync.sync()
    setWorking(false)
    const { state } = sync.status
    if (state === 'idle') toast(c.sync.synced)
    else toast(state === 'offline' ? c.sync.stillOffline : c.sync.syncFailed, 'oops')
  }

  const copyDetails = async () => {
    const [letters, lastErrorOnRecord, counts] = await Promise.all([
      db.deadLetters.toArray(),
      db.getMeta<{ message: string; at: string }>(META.lastError),
      Promise.all(SYNC_TABLES.map(async (table) => [table, await db.table(table).count()] as const)),
    ])
    const report = syncReport({
      version,
      backend: backend.name,
      now: new Date().toISOString(),
      status: sync.status,
      online: navigator.onLine,
      lang,
      theme,
      members: members?.length ?? 0,
      householdId: me?.householdId,
      memberId: me?.memberId,
      userAgent: navigator.userAgent,
      refused: letters.map((letter) => ({ table: letter.table, kind: letter.kind, lastError: letter.lastError, failedAt: letter.failedAt })),
      lastErrorOnRecord: lastErrorOnRecord ?? null,
      stuckFiles,
      rows: Object.fromEntries(counts),
    })
    const ok = await copyText(report)
    toast(ok ? t.common.copied : t.common.somethingWrong, ok ? 'ok' : 'oops')
  }

  const retry = async (which: RefusedChange[] | 'files') => {
    setProblem(null)
    setBusy(which === 'files' ? 'files' : which.length === 1 ? which[0].seq : 'all')
    try {
      if (which === 'files') await sync.retryUploads()
      // In the order they were made: a key after its envelope.
      else for (const change of which) await sync.retryRefused(change.seq)
      toast(c.sync.retried)
    } catch {
      toast(t.common.somethingWrong, 'oops')
    }
    setBusy(null)
  }

  const discard = async () => {
    if (!asking) return
    setDiscarding(true)
    setProblem(null)
    try {
      await sync.discardRefused(asking.seq)
      toast(c.sync.discarded)
    } catch (error) {
      setProblem(isBackendError(error) && (error.kind === 'network' || error.kind === 'auth') ? c.sync.discardOffline : t.common.somethingWrong)
    }
    setDiscarding(false)
    setAsking(null)
  }

  const sheet = asking ?? lastAsked

  return (
    <StepPage title={c.sync.title} backTo="/settings">
      <div className="flex flex-col gap-8 px-4" data-testid="sync-page">
        <>
            <section aria-labelledby="sync-now-title" className="flex flex-col gap-4">
              <h2 id="sync-now-title" className="sr-only">
                {c.sync.states[status.state]}
              </h2>
              <Card pad={false} className="px-4 pb-4 pt-3.5">
                <SyncPill status={status} />
                <p className="mt-2.5 text-sm leading-relaxed" data-testid="sync-advice">
                  {advice}
                </p>
                <dl className="mt-3 divide-y divide-line border-y border-line">
                  <Fact label={c.sync.lastSync} value={lastSync} testId="sync-last" />
                  <Fact label={c.sync.waiting} value={status.pending} testId="sync-pending" />
                  <Fact label={c.sync.files} value={status.uploads} testId="sync-uploads" />
                  <Fact label={c.sync.refused} value={status.stuck} testId="sync-stuck" />
                </dl>
                {status.lastError && (
                  <div className="mt-3 rounded-field border border-line bg-ground px-3 py-2.5">
                    <p className="text-2xs font-extrabold text-ink-soft">{c.sync.lastError}</p>
                    <p className="mt-0.5 break-words text-xs font-semibold leading-snug">{status.lastError}</p>
                  </div>
                )}
              </Card>
              <Button size="lg" block disabled={working} onClick={() => void syncNow()}>
                {c.sync.syncNow}
              </Button>
            </section>

            {stuckFiles > 0 && (
              <Card pad={false} className="flex flex-col items-start gap-3 p-4" data-testid="stuck-files">
                <p className="text-sm leading-snug">{c.sync.stuckFiles(stuckFiles)}</p>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void retry('files')}>
                  {c.sync.retryFiles}
                </Button>
              </Card>
            )}

            {refused && refused.length > 0 && (
              <section aria-labelledby="refused-title" className="flex flex-col gap-3" data-testid="refused">
                <div>
                  <h2 id="refused-title" className="text-xl">
                    {c.sync.refusedTitle}
                  </h2>
                  <p className="mt-1.5 text-sm text-ink-soft">{c.sync.refusedLead}</p>
                </div>
                <ul className="flex flex-col gap-3">
                  {refused.map((change) => (
                    <li key={change.seq}>
                      <Card pad={false} className="p-4" data-testid="refused-change">
                        <p className="break-words text-sm font-extrabold leading-snug">{words(change)}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{c.sync.refusedAt(moment(change.failedAt))}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="secondary" disabled={busy !== null} aria-label={`${c.sync.retry}: ${words(change)}`} onClick={() => void retry([change])}>
                            {c.sync.retry}
                          </Button>
                          <Button
                            variant="quiet"
                            disabled={busy !== null}
                            aria-label={`${c.sync.discard}: ${words(change)}`}
                            onClick={() => {
                              setLastAsked(change)
                              setAsking(change)
                            }}
                          >
                            {c.sync.discard}
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
                {refused.length > 1 && (
                  <Button variant="secondary" block disabled={busy !== null} onClick={() => void retry(refused)}>
                    {c.sync.retryAll}
                  </Button>
                )}
                {problem && <ErrorNote>{problem}</ErrorNote>}
              </section>
            )}

            <div className="flex flex-col items-center gap-1 text-center">
              <Button variant="quiet" onClick={() => void copyDetails()}>
                {c.sync.copyDetails}
              </Button>
              <p className="max-w-xs text-xs leading-snug text-ink-soft">{c.sync.copyHint}</p>
            </div>
        </>
      </div>

      {sheet && (
        <ConfirmSheet open={asking !== null} title={c.sync.discardTitle} confirmLabel={c.sync.discardConfirm} cancelLabel={c.sync.keep} busy={discarding} onClose={() => setAsking(null)} onConfirm={() => void discard()}>
          <p className="font-bold text-ink">{words(sheet)}</p>
          <p>{sheet.what === 'new' ? c.sync.discardNew : c.sync.discardChange}</p>
        </ConfirmSheet>
      )}
    </StepPage>
  )
}
