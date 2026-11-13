// Browser-side client for the pretend cloud that lives inside the dev server
// (tools/fakeCloudPlugin.ts). Used by `npm run dev` and the end-to-end tests.

import { BackendError, type Backend, type BackendErrorDetails, type BackendErrorKind, type Invite, type InvitePeek, type Membership, type ProfileInput, type PullResult, type PushOp, type PushSubscriptionInput, type PushType } from '../backend'
import type { ID, ISO } from '../types'

const BASE = '/__cloud'
const USER_KEY = 'whisperus.fake.user'

export class HttpFakeBackend implements Backend {
  readonly name = 'fake' as const

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    // Like the real backend: every call makes sure this phone has a login first.
    const userId = method === 'signIn' ? '' : (await this.ensureSession()).userId
    let res: Response
    try {
      res = await fetch(`${BASE}/rpc/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': userId },
        body: JSON.stringify(args),
      })
    } catch {
      throw new BackendError('network', 'offline')
    }
    if (res.status >= 500) throw new BackendError('network', `server_${res.status}`)
    const body = (await res.json()) as { result?: T; kind?: BackendErrorKind; code?: string; details?: BackendErrorDetails }
    if (!res.ok) throw new BackendError(body.kind ?? 'rejected', body.code ?? 'error', undefined, body.details)
    return body.result as T
  }

  async ensureSession() {
    let userId = localStorage.getItem(USER_KEY)
    if (!userId) {
      userId = await this.call<string>('signIn')
      localStorage.setItem(USER_KEY, userId)
    }
    return { userId }
  }
  membership() {
    return this.call<Membership | null>('membership')
  }
  roomExists() {
    return this.call<boolean>('roomExists')
  }
  createHousehold(name: string, me: ProfileInput, pin: string) {
    return this.call<Membership>('createHousehold', name, me, pin)
  }
  createInvite(kind: 'join' | 'restore', memberId?: ID) {
    return this.call<Invite>('createInvite', kind, memberId)
  }
  peekInvite(code: string) {
    return this.call<InvitePeek>('peekInvite', code)
  }
  joinHousehold(code: string, me: ProfileInput, pin: string) {
    return this.call<Membership & { kind: 'join' | 'restore' }>('joinHousehold', code, me, pin)
  }
  signInWithPin(name: string, pin: string) {
    return this.call<Membership>('signInWithPin', name, pin)
  }
  async setPin(pin: string) {
    await this.call<null>('setPin', pin)
  }
  async signOutDevice() {
    await this.call<null>('signOutDevice')
  }
  signOutOtherDevices() {
    return this.call<number>('signOutOtherDevices')
  }
  async setMemberPaused(memberId: ID, paused: boolean) {
    await this.call<null>('setMemberPaused', memberId, paused)
  }
  signOutMember(memberId: ID) {
    return this.call<number>('signOutMember', memberId)
  }
  async push(op: PushOp) {
    await this.call<null>('push', op)
  }
  pull(since: ISO | null) {
    return this.call<PullResult>('pull', since)
  }
  pushPublicKey() {
    return this.call<string | null>('pushPublicKey')
  }
  async savePushSubscription(subscription: PushSubscriptionInput) {
    await this.call<null>('savePushSubscription', subscription)
  }
  async setPushMuted(endpoint: string, mutedTypes: PushType[]) {
    await this.call<null>('setPushMuted', endpoint, mutedTypes)
  }
  async removePushSubscription(endpoint: string) {
    await this.call<null>('removePushSubscription', endpoint)
  }

  subscribe(householdId: ID, onChange: () => void) {
    const source = new EventSource(`${BASE}/events?household=${encodeURIComponent(householdId)}`)
    source.onmessage = () => onChange()
    source.onopen = () => onChange()
    return () => source.close()
  }

  async uploadBlob(path: string, blob: Blob) {
    const { userId } = await this.ensureSession()
    let res: Response
    try {
      res = await fetch(`${BASE}/blob/${path}`, {
        method: 'PUT',
        headers: { 'content-type': blob.type || 'application/octet-stream', 'x-user': userId },
        body: blob,
      })
    } catch {
      throw new BackendError('network', 'offline')
    }
    if (res.status >= 500) throw new BackendError('network', `server_${res.status}`)
    if (!res.ok) throw new BackendError('rejected', 'forbidden')
  }

  async downloadBlob(path: string) {
    const { userId } = await this.ensureSession()
    let res: Response
    try {
      res = await fetch(`${BASE}/blob/${path}`, { headers: { 'x-user': userId } })
    } catch {
      throw new BackendError('network', 'offline')
    }
    if (res.status === 404) return null
    if (!res.ok) throw new BackendError('network', `server_${res.status}`)
    return res.blob()
  }

  async removeBlob(path: string) {
    const { userId } = await this.ensureSession()
    let res: Response
    try {
      res = await fetch(`${BASE}/blob/${path}`, { method: 'DELETE', headers: { 'x-user': userId } })
    } catch {
      throw new BackendError('network', 'offline')
    }
    if (res.status >= 500) throw new BackendError('network', `server_${res.status}`)
    if (!res.ok) throw new BackendError('rejected', 'forbidden')
  }

  async signOut() {
    localStorage.removeItem(USER_KEY)
  }
}
