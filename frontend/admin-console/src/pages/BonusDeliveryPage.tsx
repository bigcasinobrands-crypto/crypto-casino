import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type VersionRow = {
  id: number
  version: number
  published: boolean
  created_at: string
  valid_from?: string
  valid_to?: string
  player_title?: string
  player_description?: string
  player_hero_image_url?: string
  promo_code?: string
  priority?: number
}

type PaymentFlags = {
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** Convert ISO string to value for datetime-local input (local timezone). */
function isoToLocalDatetimeValue(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function localDatetimeValueToIso(v: string): string | null {
  if (!v.trim()) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const btnPrimary =
  'rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'
const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10'

export default function BonusDeliveryPage() {
  const { id: idParam } = useParams()
  const promoId = idParam ? parseInt(idParam, 10) : NaN
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [status, setStatus] = useState('')
  const [grantsPaused, setGrantsPaused] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [flags, setFlags] = useState<PaymentFlags | null>(null)

  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [noEnd, setNoEnd] = useState(true)

  const [busy, setBusy] = useState<string | null>(null)

  const [playerTitle, setPlayerTitle] = useState('')
  const [playerDescription, setPlayerDescription] = useState('')
  const [playerHeroUrl, setPlayerHeroUrl] = useState('')

  /** Highest version row (often a draft sitting above an older published version). */
  const latest = versions[0] ?? null
  /** Row that is actually listed on the player hub (published); else the top row when nothing is live yet. */
  const publishedVersion = useMemo(() => versions.find((v) => v.published) ?? null, [versions])
  const playerHubVersion = useMemo(() => publishedVersion ?? latest, [publishedVersion, latest])

  const uploadPromoImage = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          toast.error('Image upload failed')
          return null
        }
        const j = (await res.json()) as { url: string }
        toast.success('Image uploaded')
        return j.url
      } catch {
        toast.error('Upload error')
        return null
      }
    },
    [apiFetch],
  )

  const load = useCallback(async () => {
    if (!Number.isFinite(promoId) || promoId <= 0) {
      setErr('Invalid promotion id')
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const [res, flagsRes] = await Promise.all([
        apiFetch(`/v1/admin/bonushub/promotions/${promoId}`),
        apiFetch('/v1/admin/ops/payment-flags'),
      ])
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setVersions([])
        return
      }
      const j = (await res.json()) as {
        name?: string
        slug?: string
        status?: string
        grants_paused?: boolean
        versions?: VersionRow[]
      }
      setName(j.name ?? '')
      setSlug(j.slug ?? '')
      setStatus((j.status ?? '').toLowerCase())
      setGrantsPaused(!!j.grants_paused)
      const vers = Array.isArray(j.versions) ? j.versions : []
      setVersions(vers)
      const pub = vers.find((v) => v.published)
      const hub = pub ?? vers[0]
      if (hub) {
        setPlayerTitle(hub.player_title ?? '')
        setPlayerDescription(hub.player_description ?? '')
        setPlayerHeroUrl(hub.player_hero_image_url ?? '')
        setStartLocal(isoToLocalDatetimeValue(hub.valid_from))
        if (hub.valid_to) {
          setNoEnd(false)
          setEndLocal(isoToLocalDatetimeValue(hub.valid_to))
        } else {
          setNoEnd(true)
          setEndLocal('')
        }
      }

      if (flagsRes.ok) {
        const fj = (await flagsRes.json()) as PaymentFlags
        setFlags(fj)
      } else {
        setFlags(null)
      }
    } catch {
      setErr('Network error')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, promoId])

  useEffect(() => {
    void load()
  }, [load])

  const derivedStatus = useMemo(() => {
    if (status === 'archived') return 'archived' as const
    const hasPublished = versions.some((v) => v.published)
    if (!hasPublished) return 'draft' as const
    if (grantsPaused) return 'paused' as const
    const globalsOk =
      (flags?.bonuses_enabled !== false && flags?.automated_grants_enabled !== false) || flags == null
    if (!globalsOk) return 'blocked' as const
    return 'active' as const
  }, [status, versions, grantsPaused, flags])

  const savePlayerCard = async () => {
    if (!playerHubVersion || !isSuper) return
    setBusy('playerCard')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${playerHubVersion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_title: playerTitle,
          player_description: playerDescription,
          player_hero_image_url: playerHeroUrl.trim(),
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Save player card failed (${res.status})`))
        return
      }
      toast.success('Player bonus card saved')
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const saveSchedule = async () => {
    if (!playerHubVersion || !isSuper) return
    const vf = localDatetimeValueToIso(startLocal)
    const vt = noEnd ? '' : localDatetimeValueToIso(endLocal)
    if (startLocal.trim() && !vf) {
      setErr('Start date is invalid')
      return
    }
    if (!noEnd && endLocal.trim() && !vt) {
      setErr('End date is invalid')
      return
    }
    setBusy('schedule')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${playerHubVersion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valid_from: vf ?? '',
          valid_to: noEnd ? '' : vt ?? '',
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Save schedule failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    if (!latest || latest.published) return
    setBusy('publish')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${latest.id}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Publish failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const setPaused = async (paused: boolean) => {
    if (!isSuper) return
    setBusy('pause')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants_paused: paused }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  const setArchived = async (archived: boolean) => {
    if (!isSuper) return
    setBusy('arch')
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'draft' }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusy(null)
    }
  }

  if (!Number.isFinite(promoId) || promoId <= 0) {
    return (
      <p className="text-sm text-red-600">
        Invalid promotion. <Link to="/bonushub">Back to catalog</Link>
      </p>
    )
  }

  const statusBadgeClass =
    derivedStatus === 'active'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
      : derivedStatus === 'paused'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
        : derivedStatus === 'archived'
          ? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
          : derivedStatus === 'draft'
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200'
            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'

  const statusLabel =
    derivedStatus === 'active'
      ? 'Live'
      : derivedStatus === 'paused'
        ? 'Paused'
        : derivedStatus === 'draft'
          ? 'Draft'
          : derivedStatus === 'archived'
            ? 'Archived'
            : 'Blocked'

  return (
    <>
      <PageMeta
        title="Bonus Engine · Schedule & deliver"
        description="Publish, schedule, and pause this promotion."
      />

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Schedule &amp; deliver
            </p>
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{name || 'Promotion'}</h2>
                <p className="mt-0.5 font-mono text-sm text-gray-500 dark:text-gray-400">
                  {slug} · ID {promoId}
                </p>
                <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass}`}>
                  {statusLabel}
                  {derivedStatus === 'active' ? ' · grants on' : null}
                  {derivedStatus === 'paused' ? ' · grants paused' : null}
                  {derivedStatus === 'blocked' ? ' · toggles off' : null}
                </span>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {latest && status !== 'archived' && !latest.published ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void publish()}
                  >
                    {busy === 'publish' ? 'Publishing…' : `Publish version ${latest.version}`}
                  </button>
                ) : null}
                {latest && status !== 'archived' && publishedVersion && grantsPaused ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void setPaused(false)}
                  >
                    {busy === 'pause' ? '…' : 'Resume grants'}
                  </button>
                ) : null}
                {derivedStatus === 'blocked' ? (
                  <Link to="/finance" className={`text-center ${btnPrimary}`}>
                    Review payment toggles
                  </Link>
                ) : null}
                {status === 'archived' ? (
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={!isSuper || busy !== null}
                    onClick={() => void setArchived(false)}
                  >
                    {busy === 'arch' ? '…' : 'Restore from archive'}
                  </button>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2 dark:border-gray-700 sm:border-0 sm:pt-0">
                  {latest && status !== 'archived' && publishedVersion && !grantsPaused ? (
                    <button
                      type="button"
                      className={btnSecondary}
                      disabled={!isSuper || busy !== null}
                      onClick={() => void setPaused(true)}
                    >
                      {busy === 'pause' ? '…' : 'Pause grants'}
                    </button>
                  ) : null}
                  {latest && status !== 'archived' ? (
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/40"
                      disabled={!isSuper || busy !== null}
                      onClick={() => void setArchived(true)}
                    >
                      {busy === 'arch' ? '…' : 'Archive'}
                    </button>
                  ) : null}
                  <Link to={`/bonushub/promotions/${promoId}/rules`} className={btnSecondary}>
                    Edit rules
                  </Link>
                  <Link to="/bonushub/operations" className={btnSecondary}>
                    Operations
                  </Link>
                  <Link to={`/bonushub/calendar?promo=${promoId}`} className={btnSecondary}>
                    Calendar
                  </Link>
                  <Link to="/bonushub" className={btnSecondary}>
                    Promotions
                  </Link>
                </div>
              </div>
            </div>

            {flags && (flags.bonuses_enabled === false || flags.automated_grants_enabled === false) ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Platform toggles: bonuses {flags.bonuses_enabled === false ? 'OFF' : 'ON'}, automated grants{' '}
                {flags.automated_grants_enabled === false ? 'OFF' : 'ON'}. Adjust in{' '}
                <Link to="/finance" className="font-medium underline">
                  Finance
                </Link>{' '}
                or Settings (superadmin).
              </div>
            ) : null}

            {!isSuper ? (
              <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
                Superadmin required to publish, edit schedule, pause, or archive.
              </p>
            ) : null}
          </div>

          <details className="mb-6 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
            <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
              Before you go live
            </summary>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
              <li>Publish a version so it has a published timestamp.</li>
              <li>Optional schedule: grant window must include deposit time.</li>
              <li>Bonuses and automated grants toggles ON (Finance or Settings).</li>
              <li>
                Worker + Redis for deposit automation — see Bonus Engine header <strong>Setup hint</strong>.
              </li>
              <li>Verify in player Profile → Bonuses or Operations → simulate (superadmin).</li>
            </ul>
          </details>

          {playerHubVersion ? (
            <>
            <ComponentCard
              title="Schedule"
              desc="Grant window (local time). Deposits match only while inside this window and rules allow."
            >
              <div className="grid max-w-xl gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Starts (local time)
                  </label>
                  <input
                    type="datetime-local"
                    lang="en-GB"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    disabled={!isSuper || busy !== null}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={noEnd}
                      onChange={(e) => {
                        setNoEnd(e.target.checked)
                        if (e.target.checked) setEndLocal('')
                      }}
                      disabled={!isSuper || busy !== null}
                    />
                    No end date
                  </label>
                  {!noEnd ? (
                    <>
                      <span className="mb-1 mt-2 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        Ends (local time)
                      </span>
                      <input
                        type="datetime-local"
                        lang="en-GB"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                        value={endLocal}
                        onChange={(e) => setEndLocal(e.target.value)}
                        disabled={!isSuper || busy !== null}
                      />
                    </>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={`mt-4 ${btnPrimary}`}
                disabled={!isSuper || busy !== null}
                onClick={() => void saveSchedule()}
              >
                {busy === 'schedule' ? 'Saving…' : 'Save schedule'}
              </button>
              {publishedVersion ? (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                  Version {publishedVersion.version} is published — this schedule is what the live player hub uses.
                  {latest && !latest.published && latest.id !== publishedVersion.id ? (
                    <span className="mt-1 block text-amber-800 dark:text-amber-200">
                      Draft v{latest.version} exists above it; hero and dates here still edit the{' '}
                      <strong>published</strong> row until you publish the draft.
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="mt-3 text-sm text-sky-800 dark:text-sky-200">
                  No published version yet — this schedule applies to draft v{playerHubVersion.version} until you publish.
                </p>
              )}
            </ComponentCard>

            <ComponentCard
              title="Player app — bonus card"
              desc="What eligible players see on My Bonuses (title, description, hero image). When a version is already published, edits here apply to that live row (not a newer unpublished draft). Targeting still comes from rules."
            >
              <div className="grid max-w-3xl gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Card title
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    value={playerTitle}
                    onChange={(e) => setPlayerTitle(e.target.value)}
                    placeholder="e.g. Welcome bonus 100% match"
                    disabled={!isSuper || busy !== null}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Short description (More info)
                  </label>
                  <textarea
                    className="min-h-[88px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    value={playerDescription}
                    onChange={(e) => setPlayerDescription(e.target.value)}
                    placeholder="Shown in the expandable details on the player card."
                    disabled={!isSuper || busy !== null}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Hero image
                  </label>
                  <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                    Upload (stored under <span className="font-mono">/v1/uploads/</span>) or paste a full HTTPS URL.
                    Leave empty for the default gift artwork on the player site.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      className="max-w-full text-sm text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-600 dark:text-gray-300"
                      disabled={!isSuper || busy !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (!f) return
                        void (async () => {
                          const url = await uploadPromoImage(f)
                          if (url) setPlayerHeroUrl(url)
                        })()
                      }}
                    />
                    {playerHeroUrl ? (
                      <button
                        type="button"
                        className={btnSecondary}
                        disabled={!isSuper || busy !== null}
                        onClick={() => setPlayerHeroUrl('')}
                      >
                        Remove image
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    value={playerHeroUrl}
                    onChange={(e) => setPlayerHeroUrl(e.target.value)}
                    placeholder="/v1/uploads/… or https://…"
                    disabled={!isSuper || busy !== null}
                  />
                  {playerHeroUrl ? (
                    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-800">
                      <img src={playerHeroUrl} alt="Hero preview" className="h-32 w-full object-cover" />
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className={`mt-4 ${btnPrimary}`}
                disabled={!isSuper || busy !== null}
                onClick={() => void savePlayerCard()}
              >
                {busy === 'playerCard' ? 'Saving…' : 'Save player card'}
              </button>
            </ComponentCard>
            </>
          ) : (
            <p className="text-sm text-gray-500">No versions found for this promotion.</p>
          )}
        </>
      )}
    </>
  )
}
