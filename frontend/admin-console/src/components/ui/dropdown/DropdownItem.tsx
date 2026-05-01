import type React from 'react'
import { Link } from 'react-router-dom'

interface DropdownItemProps {
  tag?: 'a' | 'button'
  to?: string
  onClick?: () => void
  onItemClick?: () => void
  /** Prepended before className; default is Bootstrap dropdown row. */
  baseClassName?: string
  className?: string
  children: React.ReactNode
}

export const DropdownItem: React.FC<DropdownItemProps> = ({
  tag = 'button',
  to,
  onClick,
  onItemClick,
  baseClassName = 'dropdown-item',
  className = '',
  children,
}) => {
  const combinedClasses = `${baseClassName} ${className}`.trim()

  const handleClick = (event: React.MouseEvent) => {
    if (tag === 'button') {
      event.preventDefault()
    }
    if (onClick) onClick()
    if (onItemClick) onItemClick()
  }

  if (tag === 'a' && to) {
    return (
      <Link to={to} className={combinedClasses} onClick={handleClick}>
        {children}
      </Link>
    )
  }

  return (
    <button type="button" onClick={handleClick} className={combinedClasses}>
      {children}
    </button>
  )
}
