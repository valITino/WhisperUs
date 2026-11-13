// A code as something the admin can hand over: a QR code of the link, the code in big
// letters, Share and Copy link. "join" invites the second person; "restore" lets the
// partner back in with a new PIN. Used after opening a room and from Settings.

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { publicUrl } from '../../app/router'
import { backend } from '../../data/app'
import type { Invite } from '../../data/backend'
import { usePartner } from '../../data/queries'
import type { ID } from '../../data/types'
import { useCopy, useT } from '../../i18n'
import { Avatar, Button, buzz, Card, Loader, toast } from '../../ui/components'
import { INVITE_LENGTH, invitePath } from './codes'
import { pairingCopy } from './copy'
import { copyText, ErrorNote } from './parts'
import { useExplain } from './useExplain'
import { QrCode } from './QrCode'

type InviteState = { status: 'loading' } | { status: 'ready'; invite: Invite } | { status: 'error'; error: unknown }

// One request per kind and person at a time, however often the screen mounts.
const inFlight = new Map<string, Promise<Invite>>()

function requestInvite(kind: 'join' | 'restore', memberId?: ID): Promise<Invite> {
  const key = `${kind}:${memberId ?? ''}`
  let request = inFlight.get(key)
  if (!request) {
    request = backend.createInvite(kind, memberId).finally(() => inFlight.delete(key))
    inFlight.set(key, request)
  }
  return request
}

function useInvite(kind: 'join' | 'restore', memberId: ID | undefined, wanted: boolean) {
  const [state, setState] = useState<InviteState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!wanted) return
    let current = true
    setState({ status: 'loading' })
    requestInvite(kind, memberId).then(
      (invite) => current && setState({ status: 'ready', invite }),
      (error: unknown) => current && setState({ status: 'error', error }),
    )
    return () => {
      current = false
    }
  }, [kind, memberId, attempt, wanted])

  return { state, retry: () => setAttempt((n) => n + 1) }
}

interface Props {
  kind: 'join' | 'restore'
  /** For a restore code: who is let back in. */
  memberId?: ID
}

export function InvitePanel({ kind, memberId }: Props) {
  const c = useCopy(pairingCopy)
  const explain = useExplain()
  const t = useT()
  const partner = usePartner()
  // An invite is only asked for once we know the partner's seat is free.
  const { state, retry } = useInvite(kind, memberId, kind === 'restore' || partner === null)
  const words = kind === 'join' ? c.invite : { ...c.invite, ...c.restoreInvite }

  // The best ending: the partner scanned the code and is now in the room.
  if (kind === 'join' && partner) {
    return (
      <Card pad={false} className="flex flex-col items-center px-5 py-7 text-center" data-testid="partner-joined">
        <motion.div initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 12 }}>
          <Avatar avatar={partner.avatar} color={partner.color} accessory={partner.accessory} size={96} name={partner.name} />
        </motion.div>
        <h2 className="mt-4 text-xl">{c.invite.joinedTitle(partner.name)}</h2>
        <p className="mt-1.5 text-balance font-script text-2xl leading-tight text-accent">{c.invite.joinedBody}</p>
      </Card>
    )
  }

  if (state.status === 'loading') {
    return (
      <Card>
        <Loader label={words.making} />
      </Card>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorNote>{explain(state.error)}</ErrorNote>
        <Button variant="secondary" onClick={retry}>
          {c.invite.retry}
        </Button>
      </div>
    )
  }

  const { code } = state.invite
  const link = publicUrl(invitePath(code))
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copyLink = async () => {
    const ok = await copyText(link)
    if (ok) buzz(10)
    toast(ok ? t.common.copied : c.invite.copyFailed, ok ? 'ok' : 'oops')
  }

  const share = async () => {
    try {
      await navigator.share({ title: t.brand.name, text: words.shareText, url: link })
    } catch (e) {
      // Closing the share sheet is not an error. Anything else: fall back to copying.
      if (!(e instanceof DOMException && e.name === 'AbortError')) await copyLink()
    }
  }

  const half = Math.ceil(INVITE_LENGTH / 2)
  return (
    <div className="flex flex-col gap-4">
      <Card pad={false} className="flex flex-col items-center px-4 pb-5 pt-5">
        <div className="rounded-2xl bg-[#fffdf9] p-4">
          <QrCode value={link} size={224} label={words.qrLabel} />
        </div>
        <p className="mt-4 text-2xs font-extrabold text-ink-soft">{words.codeLabel}</p>
        <p data-testid="invite-code" aria-label={code.split('').join(' ')} className="tabular mt-0.5 flex select-all gap-3 text-[1.75rem] font-extrabold leading-tight tracking-[0.1em]">
          <span>{code.slice(0, half)}</span>
          <span>{code.slice(half)}</span>
        </p>
        <p className="mt-2 max-w-[30ch] text-balance text-center text-xs text-ink-soft">{words.valid}</p>
      </Card>
      {canShare ? (
        <>
          <Button size="lg" block onClick={() => void share()}>
            {words.share}
          </Button>
          <Button variant="secondary" block onClick={() => void copyLink()}>
            {c.invite.copyLink}
          </Button>
        </>
      ) : (
        <Button size="lg" block onClick={() => void copyLink()}>
          {c.invite.copyLink}
        </Button>
      )}
    </div>
  )
}
