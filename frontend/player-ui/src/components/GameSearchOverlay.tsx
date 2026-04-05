import { useCallback, useEffect, useId, useRef, useState, type FC } from 'react'
import { IconSearch } from './icons'
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
  thumbnail_url?: string
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
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [games, setGames] = useState<GameRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, bumpFav] = useState(0)
  const refreshFav = useCallback(() => bumpFav((n) => n + 1), [])
  const { accessToken } = usePlayerAuth()
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
            setErr('Could not load games.')
            setGames([])
          }
          return
        }
        const j = (await res.json()) as { games: GameRow[] }
        if (!cancelled) setGames(j.games ?? [])
      } catch {
        if (!cancelled) {
          setErr('Network error.')
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

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        aria-label="Close search"
        onClick={onClose}
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col pointer-events-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#101018] px-3 py-3 sm:px-4 pointer-events-auto">
          <label id={titleId} className="sr-only">
            Search games by title or provider
          </label>
          <div className="relative min-w-0 flex-1">
            <IconSearch
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-[18px] -translate-y-1/2 text-white/35"
              size={18}
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games"
              aria-label="Search games by title or provider"
              autoComplete="off"
              className="min-w-0 w-full rounded-[4px] border border-white/[0.08] bg-[#16161f] py-3 pl-11 pr-3 text-[13px] text-white/90 outline-none transition placeholder:text-white/40 focus:border-casino-primary focus:ring-1 focus:ring-casino-primary/35"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[4px] px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-casino-bg/98 px-3 py-4 sm:px-4 pointer-events-auto">
          {!debounced ? (
            <p className="text-center text-sm text-casino-muted">Type a game or provider name to see matches.</p>
          ) : null}
          {debounced && loading && games.length === 0 && !err ? (
            <p className="text-center text-sm text-casino-muted">Searching…</p>
          ) : null}
          {err ? <p className="text-center text-sm text-red-400">{err}</p> : null}
          {debounced && !loading && !err && games.length === 0 ? (
            <p className="text-center text-sm text-casino-muted">No games match that search.</p>
          ) : null}

          {games.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5 xl:grid-cols-6">
              {games.map((g) => {
                const lobbyTo = `/casino/game-lobby/${encodeURIComponent(g.id)}`
                return (
                  <div key={g.id} className="group relative">
                    <RequireAuthLink to={lobbyTo} className="group game-thumb-link block" onClick={() => onClose()}>
                      <div className="aspect-[3/4] w-full overflow-hidden rounded-[4px] bg-casino-elevated">
                        <PortraitGameThumb url={g.thumbnail_url} title={g.title} />
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-center text-[11px] font-medium leading-tight text-casino-muted transition group-hover:text-casino-foreground">
                        {g.title}
                      </p>
                      {g.provider ? (
                        <p className="line-clamp-1 text-center text-[10px] text-casino-muted/80">{g.provider}</p>
                      ) : null}
                    </RequireAuthLink>
                    <button
                      type="button"
                      title={isFavourite(g.id) ? 'Remove favourite' : 'Favourite'}
                      className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-[4px] border border-white/15 bg-black/75 text-lg text-amber-400/90 shadow-sm backdrop-blur-sm hover:bg-black/90"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!accessToken) {
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
  )
}

export default GameSearchOverlay
