import { Toaster } from 'sonner'

export function PlayerToaster() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      theme="dark"
      toastOptions={{
        classNames: {
          toast:
            'rounded-xl border border-casino-border bg-casino-bg text-casino-foreground shadow-2xl ring-1 ring-white/[0.06]',
          title: 'font-semibold text-casino-foreground text-sm',
          description: 'text-casino-muted whitespace-pre-wrap text-xs leading-snug',
          closeButton:
            'border border-white/[0.12] bg-white/[0.06] text-casino-muted hover:bg-white/[0.1] hover:text-casino-foreground',
          error: 'border-red-500/25 bg-casino-bg [&_[data-close-button]]:text-casino-muted',
          success: 'border-emerald-500/25 bg-casino-bg',
          warning: 'border-amber-500/25 bg-casino-bg',
          info: 'border-casino-primary/30 bg-casino-bg',
        },
      }}
    />
  )
}
