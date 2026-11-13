import { motion } from 'motion/react'
import { useT } from '../../i18n'
import { WaxSeal } from '../deco/Deco'
import { Icon, type IconName } from '../deco/Icon'
import { buzz, cx } from './cx'

export type TabId = 'home' | 'us'

interface Props {
  active: TabId
  onSelect: (tab: TabId) => void
  /** The seal in the middle: step into the booth. */
  onSeal: () => void
  /** Small counters, for example envelopes that hold something new. */
  badges?: Partial<Record<TabId, number>>
  /** Render in the page flow instead of fixed to the bottom (for previews). */
  inline?: boolean
}

const tabs: { id: TabId; icon: IconName }[] = [
  { id: 'home', icon: 'home' },
  { id: 'us', icon: 'us' },
]

/**
 * Bottom navigation, shaped like the back of an envelope: the flap's point is in the
 * middle, and where a letter's seal would be sits the one thing this app is for.
 */
export function TabBar({ active, onSelect, onSeal, badges = {}, inline = false }: Props) {
  const t = useT()

  const tab = ({ id, icon }: { id: TabId; icon: IconName }) => {
    const on = active === id
    const count = badges[id] ?? 0
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        aria-label={count > 0 ? t.tabs.withNews(t.tabs[id], count) : undefined}
        onClick={() => onSelect(id)}
        className={cx('relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl', on ? 'text-accent' : 'text-ink-soft')}
      >
        <span className="relative">
          <Icon name={icon} size={24} />
          {count > 0 && (
            <span aria-hidden className="absolute -right-2.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-wax px-1 text-2xs font-extrabold leading-4.5 text-on-wax">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
        <span className={cx('text-2xs', on ? 'font-extrabold' : 'font-semibold')}>{t.tabs[id]}</span>
        {on && <motion.span layoutId="tab-dot" className="absolute bottom-0.5 size-1.5 rounded-full bg-accent" />}
      </button>
    )
  }

  return (
    <nav aria-label={t.tabs.nav} className={cx('z-40 w-full', inline ? 'relative' : 'fixed inset-x-0 bottom-0')}>
      <div className="app-column relative">
        <div className="flap-top bg-haze px-1 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          <div className="flex items-stretch">
            {tab(tabs[0])}
            {/* Room for the seal. */}
            <span aria-hidden className="w-24 shrink-0" />
            {tab(tabs[1])}
          </div>
        </div>
        <motion.button
          type="button"
          aria-label={t.tabs.seal}
          onClick={() => {
            buzz(14)
            onSeal()
          }}
          whileTap={{ scale: 0.9, rotate: -8 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          className="absolute left-1/2 -top-8 grid size-[4.5rem] -translate-x-1/2 place-items-center rounded-full drop-shadow-[0_6px_10px_#861a2b66]"
        >
          <WaxSeal size={72} />
        </motion.button>
      </div>
    </nav>
  )
}
