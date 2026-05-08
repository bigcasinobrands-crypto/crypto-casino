import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readApiError } from '../../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import { usePlayerAuth } from '../../playerAuth'
import { BonusForfeitConfirmModal } from '../rewards/BonusForfeitConfirmModal'
import { WalletInfoTrigger, WalletPanel } from './WalletShell'

type PlayerBonusRow = {
  id: string
  promotion_version_id: number
  status: string
  title?: string
}

type AvailableOfferRow = {
  promotion_version_id: number
  title?: string
  description?: string
  kind?: string
  offer_details?: {
    audience?: { first_deposit_only?: boolean }
  }
}

function statusBucket(status: string): 'active' | 'past' {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'pending' || s === 'pending_review') return 'active'
  return 'past'
}

function pickWelcomeOffer(offers: AvailableOfferRow[]): AvailableOfferRow | null {
  if (!offers.length) return null
  const welcome = offers.find((o) => o.offer_details?.audience?.first_deposit_only === true)
  return welcome ?? offers[0] ?? null
}

/**
 * “Choose your bonus” panel — active instance bonus, else best available welcome / welcome-tagged offer.
 */
export function WalletBonusStrip() {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [loading, setLoading] = useState(true)
  const [bonuses, setBonuses] = useState<PlayerBonusRow[]>([])
  const [availableOffers, setAvailableOffers] = useState<AvailableOfferRow[]>([])
  const [forfeitOpen, setForfeitOpen] = useState(false)
  const [forfeitBusy, setForfeitBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [resBonuses, resAvail] = await Promise.all([
        apiFetch('/v1/wallet/bonuses'),
        apiFetch('/v1/bonuses/available'),
      ])
      if (resBonuses.ok) {
        const j = (await resBonuses.json()) as { bonuses?: PlayerBonusRow[] }
        setBonuses(Array.isArray(j.bonuses) ? j.bonuses : [])
      } else {
        setBonuses([])
      }
      if (resAvail.ok) {
        const j = (await resAvail.json()) as { offers?: AvailableOfferRow[] }
        setAvailableOffers(Array.isArray(j.offers) ? j.offers : [])
      } else {
        setAvailableOffers([])
      }
    } catch {
      setBonuses([])
      setAvailableOffers([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void reload()
  }, [reload])

  const active = useMemo(
    () => bonuses.find((b) => statusBucket(b.status) === 'active'),
    [bonuses],
  )

  const welcomeOffer = useMemo(() => pickWelcomeOffer(availableOffers), [availableOffers])

  const activeTitle = active?.title?.trim() || active?.promotion_version_id

  const runForfeit = async () => {
    if (!active) return
    setForfeitBusy(true)
    try {
      const res = await apiFetch(`/v1/wallet/bonuses/${encodeURIComponent(active.id)}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const apiErr = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(apiErr, res.status, 'POST /v1/wallet/bonuses/forfeit', rid)
        return
      }
      setForfeitOpen(false)
      await refreshProfile()
      await reload()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/bonuses/forfeit')
    } finally {
      setForfeitBusy(false)
    }
  }

  if (loading) {
    return (
      <WalletPanel className="mb-4 py-4">
        <p className="text-xs text-wallet-subtext">{t('wallet.bonusLoading')}</p>
      </WalletPanel>
    )
  }

  return (
    <>
      <WalletPanel className="mb-4">
        <div className="mb-3 text-[13px] font-semibold text-white">{t('wallet.chooseBonus')}</div>
        {active && activeTitle ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-2 text-[13px] font-medium text-white">
              <span className="min-w-0 leading-snug">
                {t('wallet.nowActiveBonus', { title: String(activeTitle) })}
              </span>
              <WalletInfoTrigger
                label={t('wallet.activeBonusInfo')}
                title={t('wallet.activeBonusInfoTitle')}
              />
            </div>
            <button
              type="button"
              onClick={() => setForfeitOpen(true)}
              className="w-full rounded-lg bg-white py-3 text-center text-sm font-bold text-black transition hover:bg-white/90"
            >
              {t('profile.forfeit')}
            </button>
          </>
        ) : welcomeOffer?.title ? (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-casino-muted">
              {t('wallet.welcomeOfferHeading')}
            </p>
            <p className="text-[13px] font-semibold leading-snug text-white">{welcomeOffer.title}</p>
            {welcomeOffer.description?.trim() ? (
              <p className="text-[12px] leading-relaxed text-wallet-subtext">{welcomeOffer.description.trim()}</p>
            ) : null}
            <p className="text-[11px] leading-snug text-wallet-subtext">{t('wallet.welcomeOfferDepositHint')}</p>
          </div>
        ) : (
          <p className="text-[13px] text-wallet-subtext">{t('wallet.noActiveBonus')}</p>
        )}
      </WalletPanel>

      <BonusForfeitConfirmModal
        open={forfeitOpen && !!active}
        bonusTitle={active?.title?.trim() || `Bonus #${active?.promotion_version_id ?? ''}`}
        onCancel={() => setForfeitOpen(false)}
        onConfirm={() => void runForfeit()}
        busy={forfeitBusy}
        variant="instance"
      />
    </>
  )
}
