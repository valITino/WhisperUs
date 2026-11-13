import type { ReactNode } from 'react'
import { back } from '../../app/router'
import { useT } from '../../i18n'
import { cx } from './cx'
import { IconButton } from './Overlay'

/** The page background. Set tabs when the bottom navigation is showing, so content clears it. */
export function Screen({ children, tabs = false, className }: { children: ReactNode; tabs?: boolean; className?: string }) {
  return <div className={cx('min-h-dvh bg-ground', tabs ? 'pb-36' : 'pb-10', className)}>{children}</div>
}

interface PageHeaderProps {
  title: string
  /** Where "back" goes when the page was opened directly, for example "/settings". */
  backTo?: string
  action?: ReactNode
}

/** The header of every page that is not a main tab: back arrow, title, one optional action. */
export function PageHeader({ title, backTo = '/', action }: PageHeaderProps) {
  const t = useT()
  return (
    <header className="sticky top-[var(--banner-h,0px)] z-30 border-b border-line bg-ground">
      <div className="app-column flex min-h-14 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        <IconButton icon="back" label={t.common.back} onClick={() => back(backTo)} />
        <h1 className="min-w-0 flex-1 truncate text-lg">{title}</h1>
        {action}
      </div>
    </header>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

/** Two to four choices side by side, exactly one selected. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full border-[1.5px] border-line-strong bg-surface p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'min-h-11 flex-1 rounded-full px-3 text-xs font-bold transition-colors duration-150',
            value === option.value ? 'bg-ink text-ground' : 'text-ink-soft',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
