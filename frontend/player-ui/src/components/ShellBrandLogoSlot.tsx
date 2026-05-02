import type { ReactNode } from 'react'

/**
 * Wraps the header wordmark: `w-fit` + max width cap only — wallet/deposit placement is handled in
 * `App.tsx` (absolute centering on mobile/tablet) so edits here should not move the wallet pill.
 */
export function ShellBrandLogoSlot({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 w-fit max-w-[min(18rem,50vw)] shrink-0 items-center justify-start overflow-hidden">
      {children}
    </div>
  )
}
