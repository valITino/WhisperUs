import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'quiet'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg'
  icon?: ReactNode
  block?: boolean
}

const variants: Record<Variant, string> = {
  // Candy buttons: a pastel face on a darker edge that squashes when pressed.
  primary:
    'bg-candle text-on-candle shadow-[0_4px_0_var(--color-candle-edge)] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-candle-edge)]',
  secondary:
    'bg-surface text-ink border-[1.5px] border-line-strong shadow-[0_4px_0_var(--color-line)] active:translate-y-[3px] active:shadow-[0_1px_0_var(--color-line)]',
  quiet: 'text-accent underline decoration-2 underline-offset-4 decoration-transparent active:decoration-current',
}

export function Button({ variant = 'primary', size = 'md', icon, block, className, children, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-extrabold select-none',
        'transition-[transform,box-shadow] duration-100 ease-settle disabled:opacity-45 disabled:pointer-events-none',
        size === 'lg' ? 'min-h-14 px-8 text-base' : 'min-h-12 px-6 text-sm',
        variant === 'quiet' && 'px-3',
        block && 'w-full',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
