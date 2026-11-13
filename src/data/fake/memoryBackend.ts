// In-process backend for unit tests: several "phones" share one FakeCloud and each
// can be switched offline.

import { BackendError, type Backend, type ProfileInput, type PushOp, type PushSubscriptionInput, type PushType } from '../backend'
import type { ID, ISO } from '../types'
import type { FakeCloud } from './cloudCore'

export class MemoryBackend implements Backend {
  readonly name = 'memory' as const
  online = true
  private userId: string | null = null

  constructor(private readonly cloud: FakeCloud) {}

  private user(): string {
    if (!this.online) throw new BackendError('network', 'offline')
    this.userId ??= this.cloud.signIn()
    return this.userId
  }

  async ensureSession() {
    return { userId: this.user() }
  }
  async membership() {
    return this.cloud.membership(this.user())
  }
  async roomExists() {
    return this.cloud.roomExists(this.user())
  }
  async createHousehold(name: string, me: ProfileInput, pin: string) {
    return this.cloud.createHousehold(this.user(), name, me, pin)
  }
  async createInvite(kind: 'join' | 'restore', memberId?: ID) {
    return this.cloud.createInvite(this.user(), kind, memberId)
  }
  async peekInvite(code: string) {
    return this.cloud.peekInvite(this.user(), code)
  }
  async joinHousehold(code: string, me: ProfileInput, pin: string) {
    return this.cloud.joinHousehold(this.user(), code, me, pin)
  }
  async signInWithPin(name: string, pin: string) {
    return this.cloud.signInWithPin(this.user(), name, pin)
  }
  async setPin(pin: string) {
    this.cloud.setPin(this.user(), pin)
  }
  async signOutDevice() {
    this.cloud.signOutDevice(this.user())
  }
  async signOutOtherDevices() {
    return this.cloud.signOutOtherDevices(this.user())
  }
  async setMemberPaused(memberId: ID, paused: boolean) {
    this.cloud.setMemberPaused(this.user(), memberId, paused)
  }
  async signOutMember(memberId: ID) {
    return this.cloud.signOutMember(this.user(), memberId)
  }
  async push(op: PushOp) {
    this.cloud.push(this.user(), structuredClone(op))
  }
  async pull(since: ISO | null) {
    return this.cloud.pull(this.user(), since)
  }
  subscribe(householdId: ID, onChange: () => void) {
    return this.cloud.subscribe((changed) => {
      if (changed === householdId && this.online) queueMicrotask(onChange)
    })
  }
  async pushPublicKey() {
    return this.cloud.pushPublicKey(this.user())
  }
  async savePushSubscription(subscription: PushSubscriptionInput) {
    this.cloud.savePushSubscription(this.user(), structuredClone(subscription))
  }
  async setPushMuted(endpoint: string, mutedTypes: PushType[]) {
    this.cloud.setPushMuted(this.user(), endpoint, [...mutedTypes])
  }
  async removePushSubscription(endpoint: string) {
    this.cloud.removePushSubscription(this.user(), endpoint)
  }
  async uploadBlob(path: string, blob: Blob) {
    const user = this.user()
    this.cloud.uploadBlob(user, path, new Uint8Array(await blob.arrayBuffer()), blob.type)
  }
  async downloadBlob(path: string) {
    const found = this.cloud.downloadBlob(this.user(), path)
    return found ? new Blob([found.bytes as BlobPart], { type: found.type }) : null
  }
  async removeBlob(path: string) {
    this.cloud.removeBlob(this.user(), path)
  }
  async signOut() {
    this.userId = null
  }
}
