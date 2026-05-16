import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { readApiError, formatApiError } from '../../api/errors'
import { useAdminAuth } from '../../authContext'
import ComponentCard from '../common/ComponentCard'
import { Field, adminInputCls } from '../admin-ui'
import RulesEditor from './RulesEditor'
import { defaultRulesForType } from './bonusRuleTemplates'
import { validateWizardFreeSpinRules } from './FreeSpinsRewardSection'

type BonusTypeRow = { id: string; label: string; description: string }
const CALENDAR_COLOR_PRESETS = ['#3B82F6', '#10B981', '#EAB308', '#EF4444', '#06B6D4', '#6B7280', '#8B5CF6']

function slugify(raw: string): string {
  const s = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || 'bonus'
}

function isHexColor(v: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(v.trim())
}

const btnPrimary =
  'rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50'
const btnSecondary =
  'rounded-lg border border-gray-300 !bg-white px-4 py-2 text-sm font-medium !text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:!bg-gray-900 dark:!text-gray-100 dark:hover:bg-white/10'

type Props = {
  onCancel?: () => void
  onCreated?: (promotionId: number) => void
}

export default function BonusWizardFlow({ onCancel, onCreated }: Props) {
  const { apiFetch } = useAdminAuth()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [types, setTypes] = useState<BonusTypeRow[]>([])
  const [typesErr, setTypesErr] = useState<string | null>(null)
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [rules, setRules] = useState<unknown>({})
  const [termsText, setTermsText] = useState('')
  const [playerHeroImageUrl, setPlayerHeroImageUrl] = useState('')
  const [adminColor, setAdminColor] = useState('#3B82F6')
  const [vipOnly, setVipOnly] = useState(false)
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
    const color = adminColor.trim().toUpperCase()
    if (!nm || !sl) {
      setErr('Name and slug are required')
      return
    }
    if (!isHexColor(color)) {
      setErr('Calendar color must be a hex value like #3B82F6')
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
    const fsErr = validateWizardFreeSpinRules(selectedTypeId, rulesPayload)
    if (fsErr) {
      setErr(fsErr)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/bonushub/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, slug: sl, admin_color: color, vip_only: vipOnly }),
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
          player_hero_image_url: playerHeroImageUrl.trim() || undefined,
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
        onCreated?.(pid)
        return
      }
      onCreated?.(pid)
    } catch {
      setErr('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-3 d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h2 className="h5 mb-1">Create bonus</h2>
          <p className="small text-secondary mb-0">
            Choose a type, name the promotion, then configure rules.
          </p>
        </div>
        {onCancel ? (
          <button type="button" className={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>

      <div className="mb-4 d-flex gap-2 text-sm">
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

      {typesErr ? <p className="mb-3 text-danger small">{typesErr}</p> : null}
      {err ? <p className="mb-3 text-danger small">{err}</p> : null}

      {step === 1 && (
        <ComponentCard title="1 · Bonus type" desc="Pick the engine family for this offer.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTypeId(t.id)}
                className={[
                  'rounded-xl border p-4 text-left text-sm transition-all duration-150 ease-out',
                  selectedTypeId === t.id
                    ? 'border-brand-500 bg-brand-50 shadow-sm dark:bg-brand-950/40'
                    : 'border-gray-200 hover:-translate-y-0.5 hover:border-brand-300 hover:bg-gray-50 hover:shadow-sm focus-visible:-translate-y-0.5 focus-visible:border-brand-400 focus-visible:bg-gray-50 focus-visible:shadow-sm dark:border-gray-700 dark:hover:border-brand-500/60 dark:hover:bg-white/5 dark:focus-visible:border-brand-500/70 dark:focus-visible:bg-white/5',
                ].join(' ')}
              >
                <div className="font-medium text-gray-900 dark:text-white">{t.label}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.description}</div>
              </button>
            ))}
          </div>
          <div className="mt-4 d-flex gap-2">
            <button type="button" className={btnPrimary} disabled={!selectedTypeId} onClick={() => setStep(2)}>
              Continue
            </button>
          </div>
        </ComponentCard>
      )}

      {step === 2 && (
        <ComponentCard title="2 · Promotion name" desc="Visible name and URL slug (unique).">
          <div className="max-w-lg space-y-4">
            <Field label="Promotion name" hint="Shown in catalog and to staff." htmlFor="bonus-wiz-name">
              <input
                id="bonus-wiz-name"
                className={adminInputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Welcome 100% match"
              />
            </Field>
            <Field label="URL slug" hint="Unique identifier in URLs and APIs." htmlFor="bonus-wiz-slug">
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
            <Field
              label="Calendar color (admin-only)"
              hint="Used only in backoffice calendar organization, never shown to players."
              htmlFor="bonus-wiz-color"
            >
              <div className="d-flex flex-wrap align-items-center gap-2">
                <input
                  id="bonus-wiz-color"
                  type="color"
                  className="form-control form-control-color"
                  value={adminColor}
                  onChange={(e) => setAdminColor(e.target.value.toUpperCase())}
                  title="Choose calendar color"
                />
                <input
                  className={`${adminInputCls} font-mono`}
                  value={adminColor}
                  onChange={(e) => setAdminColor(e.target.value.toUpperCase())}
                  placeholder="#3B82F6"
                />
              </div>
              <div className="mt-2 d-flex flex-wrap gap-2">
                {CALENDAR_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`btn btn-sm ${adminColor === c ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAdminColor(c)}
                  >
                    <span
                      className="d-inline-block rounded-circle me-1 align-middle"
                      style={{ width: 10, height: 10, backgroundColor: c }}
                    />
                    {c}
                  </button>
                ))}
              </div>
            </Field>
            <label className="form-check mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                checked={vipOnly}
                onChange={(e) => setVipOnly(e.target.checked)}
              />
              <span className="form-check-label small ms-2">
                VIP-only promotion (hide from general player discovery until granted through VIP tier benefit).
              </span>
            </label>
          </div>
          <div className="mt-4 d-flex flex-wrap gap-2">
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
            playerHeroImageUrl={playerHeroImageUrl}
            onPlayerHeroImageUrlChange={setPlayerHeroImageUrl}
            uploadFile={uploadFile}
          />
          <div className="mt-4 d-flex flex-wrap gap-2">
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
