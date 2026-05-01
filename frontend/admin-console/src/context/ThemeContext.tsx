import type { FC, ReactNode } from 'react'
import { createContext, useContext, useEffect } from 'react'

/** Admin console is dark-only — no stored light preference. */
type Theme = 'dark'

type ThemeContextType = {
  theme: Theme
  /** @deprecated Removed from UI — kept for callers that still destructure context. */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const LOCKED_THEME: Theme = 'dark'

export const ThemeProvider: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    try {
      localStorage.setItem('theme', 'dark')
    } catch {
      /* ignore quota / private mode */
    }
    document.documentElement.classList.add('dark')
    document.documentElement.setAttribute('data-bs-theme', 'dark')
    document.body.setAttribute('data-bs-theme', 'dark')
  }, [])

  const noop = () => {}

  return (
    <ThemeContext.Provider value={{ theme: LOCKED_THEME, toggleTheme: noop }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with provider
export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
