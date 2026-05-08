import { useCallback, useEffect, useId, useRef, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { IconSearch, IconX } from './icons'
import { GameCardSkeleton } from './GameCardSkeleton'
import { GameThumbInteractiveShell } from './GameThumbInteractiveShell'
import { PortraitGameThumb } from './PortraitGameThumb'
import { RequireAuthLink } from './RequireAuthLink'
import { playerApiUrl } from '../lib/playerApiUrl'
import { isFavourite, toggleFavourite } from '../lib/gameStorage'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { saveCatalogReturnBeforeGameOpen } from '../lib/catalogReturn'

type GameRow = {
  id: string
  title: string
  provider: string
  provider_system?: string
  thumbnail_url?: string
  thumb_rev?: number
  effective_rtp_pct?: number
}

const FETCH_LIMIT = 48
const DEBOUNCE_MS = 280

type Props = {
  open: boolean
  onClose: () => void
  /** When the overlay opens, seed the input (e.g. from `?q=` on the catalog URL). */
  initialQuery?: string
}

const GameSearchOverlay: FC<Props> = ({ open, onClose, initialQuery }) => {
  const { t } = useTranslation()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [games, setGames] = useState<GameRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])
  const { isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [open, query])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = (initialQuery ?? '').trim()
    if (q) setQuery(q)
  }, [open, initialQuery])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setDebounced('')
      setGames([])
      setErr(null)
      setLoading(false)
      return
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!debounced) {
      setGames([])
      setErr(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    void (async () => {
      try {
        const res = await fetch(
          playerApiUrl(
            `/v1/games?integration=blueocean&limit=${FETCH_LIMIT}&sort=name&q=${encodeURIComponent(debounced)}`,
          ),
        )
        if (!res.ok) {
          if (!cancelled) {
            setErr(i18n.t('gameSearch.loadError'))
            setGames([])
          }
          return
        }
        const j = (await res.json()) as { games: GameRow[] }
        if (!cancelled) setGames(j.games ?? [])
      } catch {
        if (!cancelled) {
          setErr(i18n.t('common.networkError'))
          setGames([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, debounced])

  const closeIfBlankClick = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-game-search-shield]')) return
      onClose()
    },
    [onClose],
  )

  if (!open) return null

  /**
   * z-[240]: above fixed shell headers (z~211) so dim/blur covers the top bar; was trapped inside App `z-[200]` before.
   * Below mobile menu drawer (z-[260]) so menu stays on top if both were open.
   * Mobile bottom inset matches `.casino-shell-mobile-nav` via `--casino-mobile-nav-offset` (not 4rem+safe-area — that left a visible gap).
   */
  return (
    <div
      className="fixed inset-x-0 top-0 bottom-0 z-[240] flex flex-col max-[767px]:bottom-[var(--casino-mobile-nav-offset)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-x-0 top-0 bottom-0 z-0 bg-black/55 backdrop-blur-sm"
        aria-label={t('gameSearch.closeAria')}
        onClick={onClose}
      />
      <div className="relative z-10 flex h-full min-h-0 flex-1 flex-col pointer-events-none">
        <button
          type="button"
          data-game-search-shield
          onClick={onClose}
          className="pointer-events-auto absolute right-3 top-3 z-20 inline-flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-casino-primary text-white shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary [&_svg]:text-white"
          aria-label={t('gameSearch.closeAria')}
        >
          <IconX size={18} aria-hidden />
        </button>

        <div className="mx-auto grid h-full min-h-0 w-full max-w-[min(100%,90rem)] grid-rows-[minmax(0,0.22fr)_auto_minmax(0,1.6fr)] px-3 sm:px-4 lg:px-6">
          <div className="min-h-0" aria-hidden />
          <div
            className="pointer-events-auto flex justify-center px-0 pb-3"
            onMouseDown={closeIfBlankClick}
            role="presentation"
          >
            <div className="relative w-full max-w-2xl" data-game-search-shield>
              <label id={titleId} className="sr-only">
                {t('gameSearch.srTitle')}
              </label>
              <IconSearch
                className="pointer-events-none absolute left-4 top-1/2 z-10 size-[18px] -translate-y-1/2 text-white/50"
                size={18}
                aria-hidden
              />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('gameSearch.placeholder')}
                aria-label={t('gameSearch.srTitle')}
                autoComplete="off"
                className="min-w-0 w-full rounded-full border border-casino-primary/25 bg-casino-surface/90 py-2.5 pl-11 pr-11 text-[13px] text-white/90 shadow-[0_0_0_1px_rgba(123,97,255,0.12)] outline-none backdrop-blur-sm transition placeholder:text-casino-muted focus:border-casino-primary/50 focus:shadow-[0_0_0_1px_rgba(123,97,255,0.35),0_0_20px_rgba(123,97,255,0.12)]"
              />
              {query ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('')
                    inputRef.current?.focus()
                  }}
                >
                  <IconX size={18} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>

          <div
            className="mask-scroll-fade-y scrollbar-none flex min-h-0 flex-col overflow-y-auto overscroll-y-contain scroll-smooth pb-6 pt-2 motion-reduce:scroll-auto pointer-events-auto"
            onMouseDown={closeIfBlankClick}
            role="presentation"
          >
            {debounced && loading && games.length === 0 && !err ? (
              <div className="grid grid-cols-3 gap-1.5 py-2 sm:grid-cols-3 sm:gap-2 md:grid-cols-5 md:gap-2 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 min-[1700px]:grid-cols-9 min-[1920px]:grid-cols-10">
                {Array.from({ length: 18 }, (_, i) => (
                  <div key={`search-sk-${i}`} className="pointer-events-none">
                    <GameCardSkeleton />
                  </div>
                ))}
              </div>
            ) : null}
            {err ? <p className="py-6 text-center text-sm text-red-400">{err}</p> : null}
            {debounced && !loading && !err && games.length === 0 ? (
              <p className="py-6 text-center text-sm text-casino-muted/95">{t('gameSearch.noResults')}</p>
            ) : null}

            {games.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-5 md:gap-2 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 min-[1700px]:grid-cols-9 min-[1920px]:grid-cols-10">
                {games.map((g) => {
                  const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
                  return (
                    <div key={g.id} className="group relative" data-game-search-shield>
                      <RequireAuthLink to={lobbyTo} className="group game-thumb-link block" onClick={() => onClose()}>
                        <div className="aspect-[3/4] w-full overflow-hidden rounded-casino-md bg-casino-elevated">
                          <GameThumbInteractiveShell effectiveRtpPct={g.effective_rtp_pct}>
                            <PortraitGameThumb url={g.thumbnail_url} title={g.title} fallbackKey={g.id} thumbRev={g.thumb_rev} />
                          </GameThumbInteractiveShell>
                        </div>
                        <p className="mt-1 line-clamp-2 text-center text-[11px] font-medium leading-tight text-casino-muted transition group-hover:text-casino-foreground">
                          {g.title}
                        </p>
                        {(g.provider_system?.trim() || g.provider?.trim()) ? (
                          <p className="line-clamp-1 text-center text-[10px] text-casino-muted/80">
                            {g.provider_system?.trim() || g.provider}
                          </p>
                        ) : null}
                      </RequireAuthLink>
                      <button
                        type="button"
                        title={isFavourite(g.id) ? t('gameSearch.favouriteRemove') : t('gameSearch.favouriteAdd')}
                        className="absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] border border-white/15 bg-black/75 text-base text-amber-400/90 shadow-sm backdrop-blur-sm hover:bg-black/90"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (!isAuthenticated) {
                            saveCatalogReturnBeforeGameOpen()
                            openAuth('login', { navigateTo: lobbyTo })
                            return
                          }
                          toggleFavourite(g.id)
                          refreshFav()
                        }}
                      >
                        {isFavourite(g.id) ? '★' : '☆'}
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GameSearchOverlay
