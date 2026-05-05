import { useEffect, useRef, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { changePlayerLocale } from '../i18n'
import type { PlayerUiLocale } from '../lib/playerLocale'
import { IconChevronDown, IconGlobe } from './icons'

export type LanguageMenuVariant = 'collapsed' | 'expanded' | 'drawer'

type Props = {
  variant: LanguageMenuVariant
  /** Sidebar nav row class or mobile drawer row class */
  buttonClassName: string
}

const LOCALES: { code: PlayerUiLocale; labelKey: 'language.en' | 'language.frCA' }[] = [
  { code: 'en', labelKey: 'language.en' },
  { code: 'fr-CA', labelKey: 'language.frCA' },
]

export const LanguageMenu: FC<Props> = ({ variant, buttonClassName }) => {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const compact = variant === 'collapsed'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const tgt = e.target as Node
      if (btnRef.current?.contains(tgt)) return
      if (menuRef.current?.contains(tgt)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const stop = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const pick = (code: PlayerUiLocale) => {
    changePlayerLocale(code)
    setOpen(false)
  }

  const listboxClass =
    'mt-1 w-full min-w-0 divide-y divide-white/[0.06] overflow-hidden rounded-casino-md border border-casino-border bg-casino-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-white/[0.06]'

  const optionBase = (isActive: boolean, compact: boolean) =>
    compact
      ? `flex w-full items-center justify-between gap-1 px-1.5 py-2 text-left text-[10px] font-bold leading-tight transition hover:bg-casino-elevated ${
          isActive ? 'bg-casino-primary/14 text-white' : 'text-casino-foreground'
        }`
      : `flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-semibold transition hover:bg-casino-elevated ${
          isActive ? 'bg-casino-primary/12 text-white' : 'text-casino-foreground'
        }`

  return (
    <div
      onClick={stop}
      className={`flex min-w-0 flex-col ${variant === 'drawer' || variant === 'expanded' ? 'w-full' : 'w-full items-stretch'}`}
    >
      <button
        ref={btnRef}
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t('language.label')}
        title={t('language.label')}
        onClick={(e) => {
          stop(e)
          setOpen((o) => !o)
        }}
      >
        {variant === 'collapsed' ? (
          <IconGlobe size={15} aria-hidden />
        ) : variant === 'drawer' ? (
          <>
            <IconGlobe size={17} aria-hidden />
            {t('language.label')}
            <IconChevronDown
              size={15}
              className={`ml-auto shrink-0 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </>
        ) : (
          <span className="flex w-full min-w-0 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <IconGlobe size={15} className="shrink-0" aria-hidden />
              {t('language.label')}
            </span>
            <IconChevronDown
              size={15}
              className={`shrink-0 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </span>
        )}
      </button>

      {open ? (
        <div ref={menuRef} role="listbox" aria-label={t('language.label')} className={listboxClass}>
          {LOCALES.map(({ code, labelKey }) => {
            const isActive =
              (code === 'fr-CA' && i18n.language === 'fr-CA') ||
              (code === 'en' && i18n.language !== 'fr-CA')
            const shortLabel = code === 'en' ? 'EN' : 'FR'
            return (
              <button
                key={code}
                type="button"
                role="option"
                title={t(labelKey)}
                aria-selected={isActive}
                className={optionBase(isActive, compact)}
                onClick={(e) => {
                  stop(e)
                  pick(code)
                }}
              >
                <span className={compact ? 'min-w-0 truncate' : ''}>{compact ? shortLabel : t(labelKey)}</span>
                {isActive ? (
                  <span className={`shrink-0 font-bold text-casino-primary ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
                    ✓
                  </span>
                ) : (
                  <span className={`shrink-0 ${compact ? 'w-2.5' : 'w-3'}`} aria-hidden />
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
