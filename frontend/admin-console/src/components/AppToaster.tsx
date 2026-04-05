import { Toaster } from 'sonner'
import { useTheme } from '../context/ThemeContext'

/** Sonner toaster aligned with admin light/dark theme. */
export function AppToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme={theme === 'dark' ? 'dark' : 'light'}
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
