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

function statusBucket(status: string): 'active' | 'past' {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'pending' || s === 'pending_review') return 'active'
  return 'past'
}

/**
 * “Choose your bonus” panel matching Banani wallet chrome — loads active instance bonus when available.
 */
export function WalletBonusStrip() {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [loading, setLoading] = useState(true)
  const [bonuses, setBonuses] = useState<PlayerBonusRow[]>([])
  const [forfeitOpen, setForfeitOpen] = useState(false)
  const [forfeitBusy, setForfeitBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/wallet/bonuses')
      if (!res.ok) {
        setBonuses([])
        return
      }
      const j = (await res.json()) as { bonuses?: PlayerBonusRow[] }
      setBonuses(Array.isArray(j.bonuses) ? j.bonuses : [])
    } catch {
      setBonuses([])
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

  const title = active?.title?.trim() || active?.promotion_version_id

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
        {active && title ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-2 text-[13px] font-medium text-white">
              <span className="min-w-0 leading-snug">
                {t('wallet.nowActiveBonus', { title: String(title) })}
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
