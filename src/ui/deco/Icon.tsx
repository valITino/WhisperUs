// Line icons for navigation and controls. They take the colour of the text around them.

import type { ReactNode } from 'react'

const paths = {
  home: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="m3.5 7.5 8.5 6.5 8.5-6.5" />
    </>
  ),
  us: (
    <>
      <circle cx="8.5" cy="9" r="3.2" />
      <circle cx="16.5" cy="10" r="2.7" />
      <path d="M2.5 19c.5-3.5 2.8-5.5 6-5.5s5.5 2 6 5.5M15 14c3.3-.5 6 1.2 6.5 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11.5" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20Z" />
      <path d="m14 6.5 3.5 3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.7-1.4" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12c2.5-4.5 5.7-6.5 9.5-6.5s7 2 9.5 6.5c-2.5 4.5-5.7 6.5-9.5 6.5S5 16.5 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  heart: <path d="M12 20.5C5 15.5 3 11.5 3.5 8.5c.5-3 3-4.5 5.5-4 1.5.3 2.5 1.3 3 2.5.5-1.2 1.5-2.2 3-2.5 2.5-.5 5 1 5.5 4 .5 3-1.5 7-8.5 12Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2ZM10 20.5a2 2 0 0 0 4 0" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  next: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  flame: <path d="M12 21c-4 0-6.5-2.7-6.5-6 0-3 2-4.5 3-7 .5 1.5 1.3 2.3 2.5 2.5C10.5 7.5 12 5 14 3c0 3.5 4.5 6 4.5 11.5 0 3.5-2.5 6.5-6.5 6.5Z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  synced: (
    <>
      <path d="M7 18.5a4.5 4.5 0 0 1-.7-8.9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5H7Z" />
      <path d="m9.5 13.5 2 2 3.5-3.5" />
    </>
  ),
  offline: (
    <>
      <path d="M7 18.5a4.5 4.5 0 0 1-.7-8.9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5H7Z" />
      <path d="M4 4l16 16" />
    </>
  ),
  sending: (
    <>
      <path d="M7 18.5a4.5 4.5 0 0 1-.7-8.9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5H7Z" />
      <path d="M12 16v-4.5M9.8 13.5 12 11.3l2.2 2.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),

} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function Icon({ name, size = 24, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  )
}
