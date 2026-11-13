import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import type { SyncStatus } from '../../data/sync'
import { Bow, Candle, Cat, Cherries, Crown, FlameSign, Halo, Horns, Key, Mask, Moon, Peach, Sparkle, Sun } from '../deco/Deco'
import { Icon, type IconName } from '../deco/Icon'
import { cx } from './cx'

const AVATAR_ART = { moon: Moon, sun: Sun, flame: FlameSign, key: Key, cat: Cat, cherries: Cherries, peach: Peach, mask: Mask } as const
/** The disc behind a sign. Fixed colours: an avatar looks the same by day and after dark. */
const AVATAR_TONES: Record<string, string> = {
  candle: 'bg-[#f8dfae]',
  wax: 'bg-[#f3c3c8]',
  moss: 'bg-[#d3dfc5]',
  plum: 'bg-[#d9c6e2]',
}

export const AVATARS = ['moon', 'sun', 'flame', 'key', 'cat', 'cherries', 'peach', 'mask'] as const

/** Things an avatar can wear. Stored in Member.accessory; null means nothing. */
export const ACCESSORIES = ['bow', 'crown', 'halo', 'horns', 'sparkle'] as const

/** Where each accessory sits on the disc, as fractions of the avatar's size. */
const WEAR: Record<string, { art: (p: { size: number }) => ReactNode; scale: number; x: number; y: number; turn: number }> = {
  bow: { art: Bow, scale: 0.46, x: 0.62, y: -0.1, turn: 16 },
  crown: { art: Crown, scale: 0.52, x: 0.13, y: -0.25, turn: -12 },
  halo: { art: Halo, scale: 0.62, x: 0.19, y: -0.27, turn: -8 },
  horns: { art: Horns, scale: 0.62, x: 0.19, y: -0.2, turn: 0 },
  sparkle: { art: Sparkle, scale: 0.5, x: 0.62, y: -0.14, turn: 0 },
}

interface AvatarProps {
  avatar: string
  color?: string
  size?: number
  name?: string
  /** One of ACCESSORIES, or nothing. Unknown names draw nothing. */
  accessory?: string | null
}

/** A person's picture: a sign on a disc of colour, wearing an accessory if they picked one. */
export function Avatar({ avatar, color = 'candle', size = 44, name, accessory }: AvatarProps) {
  const Art = AVATAR_ART[avatar as keyof typeof AVATAR_ART] ?? Moon
  const wear = accessory ? WEAR[accessory] : undefined
  const disc = (
    <span
      role={!wear && name ? 'img' : undefined}
      aria-label={wear ? undefined : name}
      className={cx('inline-grid shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-surface', AVATAR_TONES[color] ?? AVATAR_TONES.candle)}
      style={{ width: size, height: size }}
    >
      <Art size={size * 0.66} />
    </span>
  )
  if (!wear) return disc

  // The accessory overlaps the rim like a sticker, so it gets a thin paper edge of its own.
  const edge = Math.max(1, size / 64)
  const WearArt = wear.art
  return (
    <span role={name ? 'img' : undefined} aria-label={name} className="relative inline-grid shrink-0" style={{ width: size, height: size }}>
      {disc}
      <span
        aria-hidden
        data-accessory={accessory}
        className="pointer-events-none absolute"
        style={{
          left: size * wear.x,
          top: size * wear.y,
          transform: `rotate(${wear.turn}deg)`,
          filter: `drop-shadow(${edge}px 0 0 #fdfafc) drop-shadow(-${edge}px 0 0 #fdfafc) drop-shadow(0 ${edge}px 0 #fdfafc) drop-shadow(0 -${edge}px 0 #fdfafc)`,
        }}
      >
        <WearArt size={size * wear.scale} />
      </span>
    </span>
  )
}

/** A person and their status line, as a little speech bubble. */
export function StatusBubble({ name, status, avatar, color, accessory }: { name: string; status: string; avatar: string; color?: string; accessory?: string | null }) {
  return (
    <div className="flex items-end gap-2">
      <Avatar avatar={avatar} color={color} accessory={accessory} size={40} name={name} />
      <div className="min-w-0 rounded-[18px] rounded-bl-[6px] border border-line bg-surface px-3.5 py-2">
        <p className="text-2xs font-extrabold text-ink-soft">{name}</p>
        <p className="break-words text-sm font-semibold leading-snug">{status}</p>
      </div>
    </div>
  )
}

/** An empty screen is an invitation: a candle, one line, one thing to do. */
export function EmptyState({ title, body, action, lit = true }: { title: string; body: string; action?: ReactNode; lit?: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <Candle size={92} lit={lit} />
      <h2 className="mt-4 text-xl">{title}</h2>
      <p className="mt-2 max-w-[19rem] text-sm text-ink-soft">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Loading: a candle being patient. */
export function Loader({ label }: { label?: string }) {
  const t = useT()
  return (
    <div role="status" className="flex flex-col items-center gap-2 py-6">
      <Candle size={72} />
      <span className="text-xs font-semibold text-ink-soft">{label ?? t.loading}</span>
    </div>
  )
}

/** A quiet line telling you whether your changes have reached the cloud. */
export function SyncPill({ status }: { status: Pick<SyncStatus, 'state' | 'pending' | 'uploads'> & { stuck?: number } }) {
  const t = useT()
  const waiting = status.pending + status.uploads
  let icon: IconName = 'synced'
  let text = t.sync.synced
  let dot = 'bg-moss text-on-candle'
  if (status.state === 'offline') {
    icon = 'offline'
    text = t.sync.offline
    dot = 'bg-gold text-on-candle'
  } else if (status.state === 'locked-out' || status.state === 'paused') {
    icon = 'offline'
    text = status.state === 'paused' ? t.sync.paused : t.sync.lockedOut
    dot = 'bg-wax text-on-wax'
  } else if (status.state === 'error') {
    icon = 'offline'
    text = t.sync.error
    dot = 'bg-wax text-on-wax'
  } else if (waiting > 0) {
    icon = 'sending'
    text = t.sync.sending(waiting)
    dot = 'bg-gold text-on-candle'
  } else if (status.stuck) {
    // Nothing is waiting, but not everything arrived: the Sync page in Settings has the list.
    icon = 'offline'
    text = t.sync.refused(status.stuck)
    dot = 'bg-gold text-on-candle'
  } else if (status.state === 'syncing') {
    icon = 'sending'
    text = t.sync.syncing
  }
  return (
    <span
      role="status"
      data-sync-state={status.state}
      className="inline-flex min-h-8 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-2xs font-bold text-ink"
    >
      <span className={cx('grid size-6 place-items-center rounded-full', dot)}>
        <Icon name={icon} size={15} />
      </span>
      {text}
    </span>
  )
}
