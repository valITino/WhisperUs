import { motion } from 'motion/react'
import { Avatar, cx } from '../../ui/components'

interface Props {
  name: string
  /** Empty shows the placeholder in a softer voice. */
  status: string
  placeholder?: string
  avatar: string
  color?: string
  accessory?: string | null
  /** Change this number to make the bubble hop (after "Surprise me"). */
  hop?: number
}

/**
 * A person and their status line as a speech bubble, like StatusBubble in the shared
 * components, plus the accessory and a placeholder for an empty status.
 */
export function ProfileBubble({ name, status, placeholder, avatar, color, accessory, hop = 0 }: Props) {
  const empty = status.trim() === ''
  return (
    <div className="flex items-end gap-2">
      <Avatar avatar={avatar} color={color} accessory={accessory} size={40} name={name} />
      <motion.div
        key={hop}
        initial={hop ? { scale: 0.86, rotate: -3 } : false}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 16 }}
        style={{ transformOrigin: '0% 100%' }}
        className="min-w-0 rounded-[18px] rounded-bl-[6px] border border-line bg-surface px-3.5 py-2"
      >
        <p className="text-2xs font-extrabold text-ink-soft">{name}</p>
        <p data-testid="status-preview" className={cx('break-words text-sm leading-snug', empty ? 'font-semibold text-ink-soft' : 'font-bold')}>
          {empty ? placeholder : status}
        </p>
      </motion.div>
    </div>
  )
}
