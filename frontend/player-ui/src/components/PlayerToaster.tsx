import { Toaster } from 'sonner'

export function PlayerToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme="dark"
      toastOptions={{
        classNames: {
          toast:
            'border border-casino-border bg-casino-surface text-casino-foreground shadow-lg',
          title: 'font-semibold text-casino-foreground',
          description:
            'text-casino-muted whitespace-pre-wrap text-sm',
        },
      }}
    />
  )
}
