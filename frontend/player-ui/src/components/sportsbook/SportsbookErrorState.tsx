import type { ReactNode } from 'react'

export type SportsbookErrorStateProps = {
  title?: string
  message: string
  children?: ReactNode
}

export default function SportsbookErrorState({
  title = 'Sportsbook unavailable',
  message,
  children,
}: SportsbookErrorStateProps) {
  return (
    <div
      className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
      role="alert"
    >
      <p className="text-base font-bold text-white">{title}</p>
      <p className="max-w-md text-sm text-white/75">{message}</p>
      {children}
    </div>
  )
}
