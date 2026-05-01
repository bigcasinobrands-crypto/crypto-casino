import { Toaster } from 'sonner'

/** Sonner toaster — admin console is dark-only. */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme="dark"
      toastOptions={{
        classNames: {
          toast:
            'border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
          title: 'font-semibold',
          description: 'text-gray-600 dark:text-gray-300 whitespace-pre-wrap text-sm',
        },
      }}
    />
  )
}
