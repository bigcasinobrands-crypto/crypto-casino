import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageMeta from '../components/common/PageMeta'
import RulesEditor from '../components/bonus/RulesEditor'
import { defaultRulesForType } from '../components/bonus/bonusRuleTemplates'

type VersionRow = {
  id: number
  version: number
  published: boolean
  rules?: unknown
  terms_text?: string
  bonus_type?: string
}

const btnPrimary =
  'rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'
const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10'

export default function BonusRulesPage() {
  const { id: idParam } = useParams()
  const promoId = idParam ? parseInt(idParam, 10) : NaN
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [bonusTypeId, setBonusTypeId] = useState('deposit_match')
  const [rules, setRules] = useState<unknown>({})
  const [termsText, setTermsText] = useState('')
  const [draftVid, setDraftVid] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!Number.isFinite(promoId) || promoId <= 0) {
      setErr('Invalid promotion id')
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        return
      }
      const j = (await res.json()) as {
        name?: string
        slug?: string
        versions?: VersionRow[]
      }
      setName(j.name ?? '')
      setSlug(j.slug ?? '')
      const vers = Array.isArray(j.versions) ? j.versions : []
      const draft = vers.find((v) => !v.published)
      if (draft) {
        setDraftVid(draft.id)
        const bt = (draft.bonus_type ?? 'deposit_match').trim() || 'deposit_match'
        setBonusTypeId(bt)
        const r = draft.rules
        if (r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r as object).length > 0) {
          setRules(r)
        } else {
          setRules(defaultRulesForType(bt))
        }
        setTermsText(draft.terms_text ?? '')
      } else {
        setDraftVid(null)
        const latest = vers[0]
        const bt = (latest?.bonus_type ?? 'deposit_match').trim() || 'deposit_match'
        setBonusTypeId(bt)
        setRules(latest?.rules && typeof latest.rules === 'object' ? latest.rules : defaultRulesForType(bt))
        setTermsText(latest?.terms_text ?? '')
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

  const save = async () => {
    if (draftVid == null) {
      setErr('There is no draft version to edit. Add or clone a version in Operations.')
      return
    }
    if (bonusTypeId === 'custom') {
      setErr('Custom type cannot be edited here.')
      return
    }
    if (!rules || typeof rules !== 'object' || Object.keys(rules as object).length === 0) {
      setErr('Configure rules before saving.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${draftVid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules, terms_text: termsText }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Save failed (${res.status})`))
        return
      }
      void navigate(`/bonushub/promotions/${promoId}/delivery`)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  const headline = useMemo(() => name || 'Promotion', [name])

  if (!Number.isFinite(promoId) || promoId <= 0) {
    return (
      <p className="text-sm text-red-600">
        Invalid promotion. <Link to="/bonushub">Back to promotions</Link>
      </p>
    )
  }

  return (
    <>
      <PageMeta title="Bonus Engine · Edit rules" description="Edit draft promotion rules and terms." />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit rules</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {headline} · <span className="font-mono text-xs">{slug}</span> · ID {promoId}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/bonushub/promotions/${promoId}/delivery`} className={btnSecondary}>
            Schedule &amp; deliver
          </Link>
          <Link to="/bonushub" className={btnSecondary}>
            Promotions
          </Link>
        </div>
      </div>

      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : draftVid == null ? (
        <ComponentCard
          title="No draft version"
          desc="Rules can only be changed on an unpublished version. Add a new version or clone the latest in Operations."
        >
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/bonushub/operations?tab=promotions&promo=${promoId}`}
              className={btnPrimary}
            >
              Open Operations
            </Link>
            <Link to={`/bonushub/promotions/${promoId}/delivery`} className={btnSecondary}>
              Schedule &amp; deliver
            </Link>
          </div>
        </ComponentCard>
      ) : (
        <ComponentCard
          title="Rules & terms"
          desc="Saving updates the draft only. Publish from Schedule & deliver when ready."
        >
          {!isSuper ? (
            <p className="mb-4 text-xs text-amber-800 dark:text-amber-300">
              Superadmin is required to save rule changes.
            </p>
          ) : null}
          <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
            Bonus type: <span className="font-mono">{bonusTypeId}</span> (change type by adding a new version in
            Operations).
          </p>
          <RulesEditor
            apiFetch={apiFetch}
            bonusTypeId={bonusTypeId}
            rules={rules}
            onRulesChange={setRules}
            termsText={termsText}
            onTermsTextChange={setTermsText}
          />
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!isSuper || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <Link to={`/bonushub/promotions/${promoId}/delivery`} className={btnSecondary}>
              Cancel
            </Link>
          </div>
        </ComponentCard>
      )}
    </>
  )
}
