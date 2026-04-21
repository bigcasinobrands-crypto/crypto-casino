import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { Field, adminInputCls } from '../components/admin-ui'
import RulesEditor from '../components/bonus/RulesEditor'
import { defaultRulesForType } from '../components/bonus/bonusRuleTemplates'

type BonusTypeRow = { id: string; label: string; description: string }

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || 'bonus'
}

const btnPrimary =
  'rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'
const btnSecondary =
  'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10'

export default function BonusWizardPage() {
  const { apiFetch } = useAdminAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [types, setTypes] = useState<BonusTypeRow[]>([])
  const [typesErr, setTypesErr] = useState<string | null>(null)
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)

  const [rules, setRules] = useState<unknown>({})
  const [termsText, setTermsText] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedTypeId) ?? null,
    [types, selectedTypeId],
  )

  const loadTypes = useCallback(async () => {
    setTypesErr(null)
    try {
      const res = await apiFetch('/v1/admin/bonushub/bonus-types')
      if (!res.ok) {
        const e = await readApiError(res)
        setTypesErr(formatApiError(e, `Could not load types (${res.status})`))
        setTypes([])
        return
      }
      const j = (await res.json()) as { bonus_types?: BonusTypeRow[] }
      const raw = Array.isArray(j.bonus_types) ? j.bonus_types : []
      setTypes(raw.filter((t) => t.id !== 'custom'))
    } catch {
      setTypesErr('Network error loading bonus types')
      setTypes([])
    }
  }, [apiFetch])

  useEffect(() => {
    void loadTypes()
  }, [loadTypes])

  useEffect(() => {
    const t = (searchParams.get('type') || '').trim()
    if (!t || types.length === 0) return
    if (!types.some((x) => x.id === t)) return
    setSelectedTypeId(t)
  }, [searchParams, types])

  useEffect(() => {
    if (!slugTouched && name.trim()) {
      setSlug(slugify(name))
    }
  }, [name, slugTouched])

  useEffect(() => {
    if (selectedTypeId && step === 3) {
      setRules(defaultRulesForType(selectedTypeId))
    }
  }, [selectedTypeId, step])

  const createBonus = async () => {
    if (!selectedTypeId) {
      setErr('Select a bonus type')
      return
    }
    const nm = name.trim()
    const sl = slug.trim()
    if (!nm || !sl) {
      setErr('Name and slug are required')
      return
    }
    if (selectedTypeId === 'custom') {
      setErr('Choose a standard bonus type (Custom is not supported in the visual builder).')
      return
    }
    const rulesPayload = rules
    if (!rulesPayload || typeof rulesPayload !== 'object' || Object.keys(rulesPayload as object).length === 0) {
      setErr('Configure rules before creating.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/bonushub/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, slug: sl }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Create promotion failed (${res.status})`))
        return
      }
      const j = (await res.json()) as { id?: number }
      const pid = j.id
      if (pid == null || typeof pid !== 'number') {
        setErr('Unexpected API response (missing id)')
        return
      }
      const verRes = await apiFetch(`/v1/admin/bonushub/promotions/${pid}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: rulesPayload,
          terms_text: termsText.trim(),
          bonus_type: selectedTypeId,
        }),
      })
      if (!verRes.ok) {
        const e = await readApiError(verRes)
        setErr(
          formatApiError(
            e,
            `Promotion created (#${pid}) but adding the first version failed (${verRes.status}). Open rules to retry or fix.`,
          ),
        )
        navigate(`/bonushub/promotions/${pid}/rules`)
        return
      }
      navigate(`/bonushub/promotions/${pid}/rules`)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageMeta title="Bonus Engine · Create bonus" description="Guided bonus creation." />
      <PageBreadcrumb pageTitle="Create promotion" />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create bonus</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose a type, name the promotion, then configure rules. Next you will schedule, publish, and turn the bonus on.
          </p>
        </div>
        <Link to="/bonushub" className={btnSecondary}>
          Cancel
        </Link>
      </div>

      <div className="mb-6 flex gap-2 text-sm">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={
              step === n
                ? 'rounded-full bg-brand-500 px-3 py-1 text-white'
                : 'rounded-full bg-gray-100 px-3 py-1 text-gray-600 dark:bg-white/10 dark:text-gray-300'
            }
          >
            {n === 1 ? 'Type' : n === 2 ? 'Name' : 'Rules'}
          </span>
        ))}
      </div>

      {typesErr ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{typesErr}</p> : null}
      {err ? <p className="mb-4 text-sm text-red-600 dark:text-red-400">{err}</p> : null}

      {step === 1 && (
        <ComponentCard title="1 · Bonus type" desc="Pick the engine family for this offer.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTypeId(t.id)}
                className={[
                  'rounded-xl border p-4 text-left text-sm transition-colors',
                  selectedTypeId === t.id
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                ].join(' ')}
              >
                <div className="font-medium text-gray-900 dark:text-white">{t.label}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!selectedTypeId}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </ComponentCard>
      )}

      {step === 2 && (
        <ComponentCard title="2 · Promotion name" desc="Visible name and URL slug (unique).">
          <div className="max-w-lg space-y-4">
            <Field
              label="Promotion name"
              hint="Shown in the catalog and to staff. Players see this in eligible offers."
              htmlFor="bonus-wiz-name"
            >
              <input
                id="bonus-wiz-name"
                className={adminInputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Welcome 100% match"
              />
            </Field>
            <Field
              label="URL slug"
              hint="Unique identifier in URLs and APIs. Lowercase, hyphens."
              htmlFor="bonus-wiz-slug"
            >
              <input
                id="bonus-wiz-slug"
                className={`${adminInputCls} font-mono`}
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value)
                }}
                placeholder="welcome-100"
              />
            </Field>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Lowercase letters, numbers, hyphens. Must be <strong>unique</strong> — if creation fails, change the slug or use
              the button below.
            </p>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
              onClick={() => {
                const base = slugify(name) || 'bonus'
                setSlugTouched(true)
                setSlug(`${base}-${Math.random().toString(36).slice(2, 8)}`)
              }}
            >
              Generate unique slug
            </button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setStep(1)}>
              Back
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={!name.trim() || !slug.trim()}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        </ComponentCard>
      )}

      {step === 3 && selectedTypeId && (
        <ComponentCard
          title="3 · Rules & terms"
          desc={
            selectedType
              ? `${selectedType.label} — amounts are in minor units (e.g. cents).`
              : 'Configure rules — amounts are in minor units (e.g. cents).'
          }
        >
          <RulesEditor
            apiFetch={apiFetch}
            bonusTypeId={selectedTypeId}
            rules={rules}
            onRulesChange={setRules}
            termsText={termsText}
            onTermsTextChange={setTermsText}
          />
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => setStep(2)} disabled={busy}>
              Back
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void createBonus()}>
              {busy ? 'Creating…' : 'Create bonus & continue'}
            </button>
          </div>
        </ComponentCard>
      )}
    </>
  )
}
