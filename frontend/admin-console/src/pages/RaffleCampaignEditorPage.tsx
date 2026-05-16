import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiErrFromBody, formatApiError, readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'

type PrizeForm = {
  amountMajor: string
  currency: string
  slots: string
  autoPayout: boolean
}

function isoToLocalDatetime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localDatetimeToIso(s: string): string {
  const d = new Date(s)
  return d.toISOString()
}

function majorFromMinor(minor: unknown): string {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return ''
  return (minor / 100).toFixed(2)
}

const defaultPrizes = (): PrizeForm[] => [
  { amountMajor: '2500', currency: 'USD', slots: '1', autoPayout: true },
  { amountMajor: '1800', currency: 'USD', slots: '1', autoPayout: true },
  { amountMajor: '1250', currency: 'USD', slots: '1', autoPayout: true },
]

export default function RaffleCampaignEditorPage() {
  const { id: editId } = useParams()
  const navigate = useNavigate()
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const isCreate = !editId

  const [loading, setLoading] = useState(!isCreate)
  const [saving, setSaving] = useState(false)
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null)

  const [slug, setSlug] = useState('weekly-raffle')
  const [title, setTitle] = useState('$25K Weekly Raffle')
  const [description, setDescription] = useState(
    'Earn tickets from casino and sports play, or purchase with VybeBet Gold. Winners drawn after the countdown.',
  )
  const [imageUrl, setImageUrl] = useState('')
  const [status, setStatus] = useState<'draft' | 'scheduled'>('scheduled')
  const [visibility, setVisibility] = useState<'public' | 'hidden'>('public')
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [drawLocal, setDrawLocal] = useState('')
  const [eligibleCasino, setEligibleCasino] = useState(true)
  const [eligibleSportsbook, setEligibleSportsbook] = useState(true)
  const [casinoThresholdMajor, setCasinoThresholdMajor] = useState('100')
  const [casinoTicketsPer, setCasinoTicketsPer] = useState('1')
  const [sportsThresholdMajor, setSportsThresholdMajor] = useState('100')
  const [sportsTicketsPer, setSportsTicketsPer] = useState('3')
  const [purchaseEnabled, setPurchaseEnabled] = useState(true)
  const [pricePerTicketMajor, setPricePerTicketMajor] = useState('1')
  const [everyNBuckets, setEveryNBuckets] = useState('1500')
  const [priceMultiplier, setPriceMultiplier] = useState('2')
  const [maxPurchasePerUser, setMaxPurchasePerUser] = useState('0')
  const [maxTicketsPerUser, setMaxTicketsPerUser] = useState('')
  const [maxTicketsGlobal, setMaxTicketsGlobal] = useState('')
  const [maxWinsPerUser, setMaxWinsPerUser] = useState('1')
  const [termsText, setTermsText] = useState('')
  const [responsibleNotice, setResponsibleNotice] = useState('')
  const [prizes, setPrizes] = useState<PrizeForm[]>(defaultPrizes)

  const fullEdit = useMemo(() => {
    if (isCreate) return true
    return campaignStatus === 'draft' || campaignStatus === 'scheduled'
  }, [isCreate, campaignStatus])

  const load = useCallback(async () => {
    if (!editId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/raffles/${encodeURIComponent(editId)}`)
      const j = (await res.json()) as {
        campaign?: Record<string, unknown>
        prizes?: Record<string, unknown>[]
      }
      if (!res.ok) {
        toast.error(formatApiError(await readApiError(res), `Load failed (${res.status})`))
        return
      }
      const c = j.campaign
      if (!c) {
        toast.error('Campaign missing')
        return
      }
      setCampaignStatus(typeof c.status === 'string' ? c.status : null)
      setSlug(String(c.slug ?? ''))
      setTitle(String(c.title ?? ''))
      setDescription(String(c.description ?? ''))
      setImageUrl(String(c.image_url ?? ''))
      const st = String(c.status ?? '').toLowerCase()
      setStatus(st === 'draft' ? 'draft' : 'scheduled')
      setVisibility(String(c.visibility ?? 'public') === 'hidden' ? 'hidden' : 'public')
      setStartLocal(isoToLocalDatetime(String(c.start_at ?? '')))
      setEndLocal(isoToLocalDatetime(String(c.end_at ?? '')))
      setDrawLocal(isoToLocalDatetime(String(c.draw_at ?? '')))

      let products: string[] = []
      try {
        const raw = c.eligible_products
        if (Array.isArray(raw)) products = raw.map((x) => String(x).toLowerCase())
        else if (typeof raw === 'string') products = JSON.parse(raw) as string[]
      } catch {
        products = ['casino', 'sportsbook']
      }
      setEligibleCasino(products.some((p) => p === 'casino'))
      setEligibleSportsbook(products.some((p) => p === 'sportsbook'))

      let ticketCfg: Record<string, unknown> = {}
      try {
        if (typeof c.ticket_rate_config === 'object' && c.ticket_rate_config !== null) {
          ticketCfg = c.ticket_rate_config as Record<string, unknown>
        }
      } catch {
        ticketCfg = {}
      }
      const cas = (ticketCfg.casino as Record<string, unknown> | undefined) ?? {}
      const spo = (ticketCfg.sportsbook as Record<string, unknown> | undefined) ?? {}
      setCasinoThresholdMajor(majorFromMinor(cas.threshold_minor) || '100')
      setCasinoTicketsPer(String(cas.tickets_per_threshold ?? '1'))
      setSportsThresholdMajor(majorFromMinor(spo.threshold_minor) || '100')
      setSportsTicketsPer(String(spo.tickets_per_threshold ?? '3'))

      setPurchaseEnabled(Boolean(c.purchase_enabled))
      let pc: Record<string, unknown> = {}
      try {
        if (typeof c.purchase_config === 'object' && c.purchase_config !== null) {
          pc = c.purchase_config as Record<string, unknown>
        }
      } catch {
        pc = {}
      }
      setPricePerTicketMajor(majorFromMinor(pc.price_per_ticket_minor) || '1')
      setEveryNBuckets(String(pc.every_n_tickets_bucket ?? '1500'))
      setPriceMultiplier(String(pc.price_multiplier_numerator ?? '2'))
      setMaxPurchasePerUser(String(pc.max_purchase_per_user ?? '0'))

      setMaxTicketsPerUser(c.max_tickets_per_user != null ? String(c.max_tickets_per_user) : '')
      setMaxTicketsGlobal(c.max_tickets_global != null ? String(c.max_tickets_global) : '')
      setMaxWinsPerUser(String(c.max_wins_per_user ?? '1'))
      setTermsText(String(c.terms_text ?? ''))
      setResponsibleNotice(String(c.responsible_notice ?? ''))

      const pr = Array.isArray(j.prizes) ? j.prizes : []
      if (pr.length > 0) {
        setPrizes(
          pr.map((p) => ({
            amountMajor: majorFromMinor(p.amount_minor) || '0',
            currency: String(p.currency ?? 'USD'),
            slots: String(p.winner_slots ?? '1'),
            autoPayout: Boolean(p.auto_payout),
          })),
        )
      } else {
        setPrizes(defaultPrizes())
      }
    } finally {
      setLoading(false)
    }
  }, [apiFetch, editId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isCreate) return
    const now = new Date()
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
    setStartLocal(isoToLocalDatetime(start.toISOString()))
    setEndLocal(isoToLocalDatetime(end.toISOString()))
  }, [isCreate])

  const buildPayload = () => {
    const products: string[] = []
    if (eligibleCasino) products.push('casino')
    if (eligibleSportsbook) products.push('sportsbook')
    if (products.length === 0) products.push('casino')

    const thresholdCasino = Math.round(parseFloat(casinoThresholdMajor || '0') * 100)
    const thresholdSports = Math.round(parseFloat(sportsThresholdMajor || '0') * 100)

    const prizeRows = prizes.map((p, i) => ({
      rank_order: i + 1,
      prize_type: 'cash',
      amount_minor: Math.round(parseFloat(p.amountMajor || '0') * 100),
      currency: (p.currency || 'USD').toUpperCase(),
      winner_slots: Math.max(1, parseInt(p.slots || '1', 10) || 1),
      auto_payout: p.autoPayout,
      requires_approval: false,
    }))

    return {
      slug: slug.trim().toLowerCase(),
      title: title.trim(),
      description: description.trim(),
      image_url: imageUrl.trim() || null,
      status,
      visibility,
      start_at: localDatetimeToIso(startLocal),
      end_at: localDatetimeToIso(endLocal),
      draw_at: drawLocal.trim() ? localDatetimeToIso(drawLocal) : null,
      eligible_products: products,
      eligible_currencies: [] as string[],
      ticket_rate_config: {
        casino: {
          threshold_minor: Math.max(1, thresholdCasino),
          tickets_per_threshold: Math.max(1, parseInt(casinoTicketsPer || '1', 10) || 1),
        },
        sportsbook: {
          threshold_minor: Math.max(1, thresholdSports),
          tickets_per_threshold: Math.max(1, parseInt(sportsTicketsPer || '1', 10) || 1),
        },
      },
      purchase_enabled: purchaseEnabled,
      purchase_config: {
        price_per_ticket_minor: Math.max(1, Math.round(parseFloat(pricePerTicketMajor || '0') * 100)),
        every_n_tickets_bucket: Math.max(0, parseInt(everyNBuckets || '0', 10) || 0),
        price_multiplier_numerator: Math.max(1, parseInt(priceMultiplier || '2', 10) || 2),
        max_purchase_per_user: Math.max(0, parseInt(maxPurchasePerUser || '0', 10) || 0),
      },
      max_tickets_per_user: maxTicketsPerUser.trim() ? parseInt(maxTicketsPerUser, 10) : null,
      max_tickets_global: maxTicketsGlobal.trim() ? parseInt(maxTicketsGlobal, 10) : null,
      max_wins_per_user: Math.max(1, parseInt(maxWinsPerUser || '1', 10) || 1),
      terms_text: termsText.trim(),
      responsible_notice: responsibleNotice.trim(),
      prizes: prizeRows,
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!isSuper) {
      toast.error('Superadmin role required to save raffles.')
      return
    }
    if (fullEdit) {
      const s = new Date(startLocal).getTime()
      const e = new Date(endLocal).getTime()
      if (!startLocal || !endLocal || Number.isNaN(s) || Number.isNaN(e) || e < s) {
        toast.error('Schedule invalid: set start/end so the window ends after it begins.')
        return
      }
      if (prizes.length === 0) {
        toast.error('Add at least one prize row.')
        return
      }
    }
    if (!fullEdit) {
      const cosmeticPayload = {
        title: title.trim(),
        description: description.trim(),
        image_url: imageUrl.trim() || null,
        terms_text: termsText.trim(),
        responsible_notice: responsibleNotice.trim(),
      }
      setSaving(true)
      try {
        const res = await apiFetch(`/v1/admin/raffles/${encodeURIComponent(editId!)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cosmeticPayload),
        })
        const j = await res.json().catch(() => null)
        if (!res.ok) {
          toast.error(formatApiError(apiErrFromBody(j, res.status), `Save failed (${res.status})`))
          return
        }
        toast.success('Copy updated (title, description, terms).')
        navigate(`/raffles/${encodeURIComponent(editId!)}`)
      } finally {
        setSaving(false)
      }
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload()
      const url = isCreate ? '/v1/admin/raffles' : `/v1/admin/raffles/${encodeURIComponent(editId!)}`
      const res = await apiFetch(url, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = (await res.json().catch(() => null)) as { id?: string } | null
      if (!res.ok) {
        toast.error(formatApiError(apiErrFromBody(j, res.status), `Save failed (${res.status})`))
        return
      }
      toast.success(isCreate ? 'Campaign created.' : 'Campaign updated.')
      const newId = j && typeof j.id === 'string' ? j.id : editId
      if (newId) navigate(`/raffles/${encodeURIComponent(newId)}`)
      else navigate('/raffles')
    } finally {
      setSaving(false)
    }
  }

  const addPrizeRow = () => {
    setPrizes((prev) => [...prev, { amountMajor: '500', currency: 'USD', slots: '1', autoPayout: true }])
  }

  const removePrizeRow = (idx: number) => {
    setPrizes((prev) => prev.filter((_, i) => i !== idx))
  }

  if (loading) {
    return <p className="text-secondary small py-3">Loading campaign…</p>
  }

  return (
    <>
      <PageMeta title={isCreate ? 'Raffles · New campaign' : 'Raffles · Edit campaign'} description="Configure raffle timing and economics." />
      <div className="d-flex flex-wrap gap-2 mb-3">
        <Link to="/raffles" className="btn btn-outline-secondary btn-sm">
          ← Campaigns
        </Link>
        {!isCreate && editId ? (
          <Link to={`/raffles/${encodeURIComponent(editId)}`} className="btn btn-outline-secondary btn-sm">
            View detail
          </Link>
        ) : null}
      </div>

      {!isSuper ? (
        <div className="alert alert-warning">Sign in as superadmin to create or edit raffle campaigns.</div>
      ) : null}

      {!fullEdit && !isCreate ? (
        <div className="alert alert-info">
          This campaign is live or completed. Saving only updates <strong>title</strong>, <strong>description</strong>,{' '}
          <strong>hero image URL</strong>, and legal copy — not schedule, ticket math, or prizes.
        </div>
      ) : null}

      <form onSubmit={onSubmit}>
        <ComponentCard title="Identity & visibility" desc="Slug is used in URLs; use lowercase letters and hyphens only.">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label small text-secondary">Slug</label>
              <input
                className="form-control form-control-sm"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={!fullEdit}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              />
            </div>
            <div className="col-md-8">
              <label className="form-label small text-secondary">Title</label>
              <input className="form-control form-control-sm" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="col-12">
              <label className="form-label small text-secondary">Description</label>
              <textarea className="form-control form-control-sm" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="col-12">
              <label className="form-label small text-secondary">Hero image URL (optional)</label>
              <input className="form-control form-control-sm" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Player visibility</label>
              <select
                className="form-select form-select-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'hidden')}
                disabled={!fullEdit}
              >
                <option value="public">Public (player UI)</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Initial status</label>
              <select
                className="form-select form-select-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as 'draft' | 'scheduled')}
                disabled={!fullEdit}
              >
                <option value="draft">Draft (worker will not promote)</option>
                <option value="scheduled">Scheduled (promotes when inside window)</option>
              </select>
            </div>
          </div>
        </ComponentCard>

        <ComponentCard
          title="Schedule (player countdown)"
          desc="Times use your browser local timezone and are stored as UTC. End must be after start. Worker promotes scheduled → active when now is inside [start, end]."
        >
          <fieldset disabled={!fullEdit} className="row g-3 border-0">
            <div className="col-md-4">
              <label className="form-label small text-secondary">Wager window start</label>
              <input
                type="datetime-local"
                className="form-control form-control-sm"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required={fullEdit}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Wager window end</label>
              <input
                type="datetime-local"
                className="form-control form-control-sm"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
                required={fullEdit}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Planned draw (optional)</label>
              <input type="datetime-local" className="form-control form-control-sm" value={drawLocal} onChange={(e) => setDrawLocal(e.target.value)} />
            </div>
          </fieldset>
        </ComponentCard>

        <ComponentCard
          title="Ticket earning (wager)"
          desc="Matches backend ticket_rate_config: tickets = floor(stake ÷ threshold) × tickets_per_threshold. Amounts in fiat majors (e.g. 100 = $100)."
        >
          <fieldset disabled={!fullEdit} className="border-0">
            <div className="row g-2 mb-3">
              <div className="col-auto">
                <label className="form-check">
                  <input type="checkbox" className="form-check-input" checked={eligibleCasino} onChange={(e) => setEligibleCasino(e.target.checked)} />
                  <span className="form-check-label small">Casino stakes earn tickets</span>
                </label>
              </div>
              <div className="col-auto">
                <label className="form-check">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={eligibleSportsbook}
                    onChange={(e) => setEligibleSportsbook(e.target.checked)}
                  />
                  <span className="form-check-label small">Sportsbook stakes earn tickets</span>
                </label>
              </div>
            </div>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="fw-semibold small mb-2">Casino</div>
                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label small text-secondary">Threshold ($)</label>
                    <input className="form-control form-control-sm" value={casinoThresholdMajor} onChange={(e) => setCasinoThresholdMajor(e.target.value)} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small text-secondary">Tickets per threshold</label>
                    <input className="form-control form-control-sm" value={casinoTicketsPer} onChange={(e) => setCasinoTicketsPer(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="col-md-6">
                <div className="fw-semibold small mb-2">Sportsbook</div>
                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label small text-secondary">Threshold ($)</label>
                    <input className="form-control form-control-sm" value={sportsThresholdMajor} onChange={(e) => setSportsThresholdMajor(e.target.value)} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small text-secondary">Tickets per threshold</label>
                    <input className="form-control form-control-sm" value={sportsTicketsPer} onChange={(e) => setSportsTicketsPer(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
        </ComponentCard>

        <ComponentCard title="Purchases (VybeBet Gold)" desc="Maps to purchase_config on the API. Bucket 0 = flat price per ticket.">
          <fieldset disabled={!fullEdit} className="border-0 row g-3">
            <div className="col-12">
              <label className="form-check">
                <input type="checkbox" className="form-check-input" checked={purchaseEnabled} onChange={(e) => setPurchaseEnabled(e.target.checked)} />
                <span className="form-check-label small">Allow ticket purchases while campaign is active</span>
              </label>
            </div>
            <div className="col-md-3">
              <label className="form-label small text-secondary">Base price / ticket ($)</label>
              <input className="form-control form-control-sm" value={pricePerTicketMajor} onChange={(e) => setPricePerTicketMajor(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label small text-secondary">Double price every N tickets sold</label>
              <input className="form-control form-control-sm" value={everyNBuckets} onChange={(e) => setEveryNBuckets(e.target.value)} />
              <div className="form-text">Use 0 for no escalation.</div>
            </div>
            <div className="col-md-3">
              <label className="form-label small text-secondary">Price multiplier</label>
              <input className="form-control form-control-sm" value={priceMultiplier} onChange={(e) => setPriceMultiplier(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label small text-secondary">Max purchased tickets / user</label>
              <input className="form-control form-control-sm" value={maxPurchasePerUser} onChange={(e) => setMaxPurchasePerUser(e.target.value)} />
              <div className="form-text">0 = unlimited.</div>
            </div>
          </fieldset>
        </ComponentCard>

        <ComponentCard title="Caps" desc="Optional global safeguards (leave blank for unlimited).">
          <fieldset disabled={!fullEdit} className="border-0 row g-3">
            <div className="col-md-4">
              <label className="form-label small text-secondary">Max tickets per player (all sources)</label>
              <input className="form-control form-control-sm" value={maxTicketsPerUser} onChange={(e) => setMaxTicketsPerUser(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Max tickets globally</label>
              <input className="form-control form-control-sm" value={maxTicketsGlobal} onChange={(e) => setMaxTicketsGlobal(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label small text-secondary">Max prize wins per player</label>
              <input className="form-control form-control-sm" value={maxWinsPerUser} onChange={(e) => setMaxWinsPerUser(e.target.value)} />
            </div>
          </fieldset>
        </ComponentCard>

        <ComponentCard
          title="Prize ladder (cash)"
          desc="One row per rank (1st, 2nd, …). Amounts in majors; stored as minor units on the server."
        >
          <fieldset disabled={!fullEdit} className="border-0">
            <div className="table-responsive mb-2">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Amount</th>
                    <th>CCY</th>
                    <th>Slots</th>
                    <th>Auto-pay</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {prizes.map((p, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ maxWidth: 120 }}>
                        <input className="form-control form-control-sm" value={p.amountMajor} onChange={(e) => setPrizes((x) => x.map((r, j) => (j === i ? { ...r, amountMajor: e.target.value } : r)))} />
                      </td>
                      <td style={{ maxWidth: 90 }}>
                        <input className="form-control form-control-sm" value={p.currency} onChange={(e) => setPrizes((x) => x.map((r, j) => (j === i ? { ...r, currency: e.target.value } : r)))} />
                      </td>
                      <td style={{ maxWidth: 70 }}>
                        <input className="form-control form-control-sm" value={p.slots} onChange={(e) => setPrizes((x) => x.map((r, j) => (j === i ? { ...r, slots: e.target.value } : r)))} />
                      </td>
                      <td>
                        <input type="checkbox" className="form-check-input" checked={p.autoPayout} onChange={(e) => setPrizes((x) => x.map((r, j) => (j === i ? { ...r, autoPayout: e.target.checked } : r)))} />
                      </td>
                      <td>
                        <button type="button" className="btn btn-link btn-sm text-danger p-0" onClick={() => removePrizeRow(i)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addPrizeRow} disabled={!fullEdit}>
              Add prize row
            </button>
          </fieldset>
        </ComponentCard>

        <ComponentCard title="Legal copy" desc="Shown on the player raffle page when wired in UI.">
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label small text-secondary">Terms</label>
              <textarea className="form-control form-control-sm" rows={4} value={termsText} onChange={(e) => setTermsText(e.target.value)} />
            </div>
            <div className="col-12">
              <label className="form-label small text-secondary">Responsible gambling notice</label>
              <textarea className="form-control form-control-sm" rows={2} value={responsibleNotice} onChange={(e) => setResponsibleNotice(e.target.value)} />
            </div>
          </div>
        </ComponentCard>

        <div className="d-flex gap-2 mb-5">
          <button type="submit" className="btn btn-primary" disabled={!isSuper || saving}>
            {saving ? 'Saving…' : isCreate ? 'Create campaign' : 'Save'}
          </button>
          <Link to="/raffles" className="btn btn-outline-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  )
}
