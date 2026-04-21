import { useState, type ReactNode } from 'react'

const cardCls =
  'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]'

export function AdminSection({
  title,
  desc,
  defaultOpen = true,
  children,
}: {
  title: string
  desc?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cardCls}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-6 py-5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">{title}</h3>
          {desc ? <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{desc}</p> : null}
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div className="border-t border-gray-100 px-6 py-5 dark:border-gray-800 space-y-5">{children}</div>
      ) : null}
    </div>
  )
}
