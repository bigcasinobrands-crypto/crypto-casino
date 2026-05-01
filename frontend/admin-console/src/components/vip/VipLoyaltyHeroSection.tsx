import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { adminInputCls } from '../admin-ui/inputStyles'

export const VIP_LOYALTY_HERO_CONTENT_KEY = 'vip_loyalty_hero'

export type VipLoyaltyHeroSlide = {
  image_url: string
  headline: string
  description: string
}

export type VipLoyaltyHeroPayload = {
  slide_interval_sec: number
  slides: VipLoyaltyHeroSlide[]
}

const defaultPayload: VipLoyaltyHeroPayload = {
  slide_interval_sec: 8,
  slides: [
    {
      image_url: '',
      headline: 'New Loyalty Program',
      description: '10 statuses & new perks to reach',
    },
  ],
}

function normalizePayload(raw: unknown): VipLoyaltyHeroPayload {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  let sec = Number(o.slide_interval_sec)
  if (!Number.isFinite(sec)) sec = defaultPayload.slide_interval_sec
  sec = Math.min(120, Math.max(3, Math.round(sec)))

  const slidesIn = o.slides
  const slides: VipLoyaltyHeroSlide[] = []
  if (Array.isArray(slidesIn)) {
    for (const item of slidesIn) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const row = item as Record<string, unknown>
      slides.push({
        image_url: typeof row.image_url === 'string' ? row.image_url.trim() : '',
        headline: typeof row.headline === 'string' ? row.headline : '',
        description: typeof row.description === 'string' ? row.description : '',
      })
    }
  }
  if (slides.length === 0) return structuredClone(defaultPayload)
  if (slides.length > 12) slides.length = 12
  return { slide_interval_sec: sec, slides }
}

const labelCls = 'form-label small mb-1'
const inputCls = 'form-control form-control-sm'
const tileBtn =
  'rounded-md bg-brand-500 px-2 py-1 text-xs text-white hover:bg-brand-600 disabled:opacity-50 transition-colors'

export function VipLoyaltyHeroSection({
  apiFetch,
  role,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  role?: string | null
}) {
  const canEdit = role === 'superadmin'
  const [payload, setPayload] = useState<VipLoyaltyHeroPayload>(structuredClone(defaultPayload))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null)

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          toast.error('Upload failed')
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await apiFetch(`/v1/admin/content/${encodeURIComponent(VIP_LOYALTY_HERO_CONTENT_KEY)}`)
        if (!cancelled && res.ok) {
          const j = (await res.json()) as { content?: unknown }
          setPayload(normalizePayload(j.content))
        } else if (!cancelled && res.status === 404) {
          setPayload(structuredClone(defaultPayload))
        }
      } catch {
        if (!cancelled) toast.error('Could not load VIP hero content')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  const persist = async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/content/${encodeURIComponent(VIP_LOYALTY_HERO_CONTENT_KEY)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: payload }),
      })
      if (!res.ok) {
        toast.error(`Save failed (${res.status})`)
        return
      }
      toast.success('VIP page hero saved')
    } catch {
      toast.error('Network error saving hero')
    } finally {
      setSaving(false)
    }
  }

  const updateSlide = (i: number, patch: Partial<VipLoyaltyHeroSlide>) => {
    setPayload((prev) => {
      const slides = [...prev.slides]
      slides[i] = { ...slides[i], ...patch }
      return { ...prev, slides }
    })
  }

  const addSlide = () =>
    setPayload((prev) => ({
      ...prev,
      slides: [...prev.slides, { image_url: '', headline: '', description: '' }].slice(0, 12),
    }))

  const removeSlide = (i: number) =>
    setPayload((prev) => ({
      ...prev,
      slides: prev.slides.length <= 1 ? prev.slides : prev.slides.filter((_, j) => j !== i),
    }))

  const onPickFile = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !canEdit) return
    setUploadingIdx(i)
    try {
      const url = await uploadFile(f)
      if (url) updateSlide(i, { image_url: url })
    } finally {
      setUploadingIdx(null)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="border-bottom px-3 py-2 d-flex flex-wrap align-items-center justify-content-between gap-2 bg-body-tertiary">
        <div>
          <div className="small fw-semibold text-secondary text-uppercase">VIP / Rewards loyalty hero</div>
          <p className="mb-0 mt-1 small text-secondary max-w-xl">
            Top banner on the player <strong>VIP</strong> page (/vip): slides are arranged in a <strong>4-column</strong> grid on wide screens (
            stacks 2 cols → 3 → 4). Optional image; otherwise the default gradient is used.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={!canEdit || saving || loading} onClick={() => void persist()}>
          {saving ? 'Saving…' : 'Save hero'}
        </button>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="small text-secondary mb-0">Loading…</p>
        ) : (
          <>
            <div className="row g-2 mb-3">
              <div className="col-md-4">
                <label className={labelCls} htmlFor="vipHeroInterval">
                  Seconds between slides
                </label>
                <input
                  id="vipHeroInterval"
                  className={inputCls}
                  type="number"
                  min={3}
                  max={120}
                  disabled={!canEdit}
                  value={payload.slide_interval_sec}
                  onChange={(e) =>
                    setPayload((p) => ({
                      ...p,
                      slide_interval_sec: Math.min(120, Math.max(3, parseInt(e.target.value, 10) || 3)),
                    }))
                  }
                />
                <p className="small text-secondary mb-0 mt-1">3–120 seconds.</p>
              </div>
            </div>

            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
              <span className="small fw-semibold text-secondary text-uppercase">Slides ({payload.slides.length})</span>
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={!canEdit || payload.slides.length >= 12} onClick={addSlide}>
                Add slide
              </button>
            </div>

            {/* 2 → 3 → 4 columns: compact tiles like a “4×4-style” gallery */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {payload.slides.map((slide, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-lg border border-gray-200 bg-body-secondary p-2 shadow-sm dark:border-gray-700"
                >
                  <div className="mb-2 flex items-start justify-between gap-1">
                    <span className="small fw-bold text-secondary truncate" title={`Slide ${i + 1}`}>
                      Slide {i + 1}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm py-0 px-2 shrink-0"
                      style={{ fontSize: '11px', lineHeight: 1.4 }}
                      disabled={!canEdit || payload.slides.length <= 1}
                      onClick={() => removeSlide(i)}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-900">
                    {slide.image_url.trim() !== '' ? (
                      <img src={slide.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center px-2 text-center">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-secondary">Gradient</span>
                        <span className="mt-1 text-[10px] text-secondary opacity-75">No image URL</span>
                      </div>
                    )}
                  </div>

                  <label className={labelCls} style={{ fontSize: '11px' }}>
                    Image URL
                  </label>
                  <input
                    className={adminInputCls + ' mb-2'}
                    style={{ fontSize: '12px' }}
                    value={slide.image_url}
                    onChange={(e) => updateSlide(i, { image_url: e.target.value })}
                    disabled={!canEdit}
                    placeholder="https://… or /v1/uploads/…"
                  />
                  <div className="mb-2">
                    <label className={`${tileBtn} inline-block cursor-pointer ${!canEdit || uploadingIdx === i ? 'pointer-events-none opacity-50' : ''}`}>
                      <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onPickFile(i, e)} disabled={!canEdit || uploadingIdx === i} />
                      {uploadingIdx === i ? '…' : 'Upload'}
                    </label>
                  </div>

                  <label className={labelCls} style={{ fontSize: '11px' }}>
                    Headline
                  </label>
                  <input
                    className={inputCls + ' mb-2'}
                    value={slide.headline}
                    onChange={(e) => updateSlide(i, { headline: e.target.value })}
                    disabled={!canEdit}
                    placeholder="Headline"
                  />

                  <label className={labelCls} style={{ fontSize: '11px' }}>
                    Description
                  </label>
                  <textarea className={inputCls + ' mb-0 flex-1'} rows={2} value={slide.description} onChange={(e) => updateSlide(i, { description: e.target.value })} disabled={!canEdit} placeholder="Subtitle" />
                </div>
              ))}
            </div>

            {!canEdit ? <p className="small text-secondary mt-3 mb-0">Superadmin required to edit this content.</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
