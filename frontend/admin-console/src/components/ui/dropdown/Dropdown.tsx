import type React from 'react'
import { useEffect, useRef } from 'react'

interface DropdownProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  /** Appended to Bootstrap `dropdown-menu show` (positioning, width, padding). */
  className?: string
  style?: React.CSSProperties
}

/**
 * Bootstrap-aligned panel: uses `dropdown-menu` so colors track `data-bs-theme` on html/body.
 */
export const Dropdown: React.FC<DropdownProps> = ({
  isOpen,
  onClose,
  children,
  className = '',
  style,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('.dropdown-toggle')
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  if (!isOpen) return null

  return (
    <div
      ref={dropdownRef}
      className={['dropdown-menu', 'show', className].filter(Boolean).join(' ')}
      style={{ zIndex: 1055, ...style }}
    >
      {children}
    </div>
  )
}
