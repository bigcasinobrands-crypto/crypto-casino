import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RaffleHeroSection } from '../components/raffle/RaffleHeroSection'
import { RaffleHowItWorks } from '../components/raffle/RaffleHowItWorks'
import { RafflePrizesGrid } from '../components/raffle/RafflePrizesGrid'
import { RafflePurchasePanel } from '../components/raffle/RafflePurchasePanel'
import { RaffleRewardsCard } from '../components/raffle/RaffleRewardsCard'
import type { ApiRafflePrizeRow } from '../lib/raffleMockData'
import { playerFetch } from '../lib/playerFetch'
import { usePlayerAuth } from '../playerAuth'

type ActiveCampaign = {
  id: string
  slug: string
  end_at?: string
  status?: string
}

type ActiveResp = {
  system_enabled?: boolean
  active: ActiveCampaign | null
}

type DetailResp = {
  prizes?: ApiRafflePrizeRow[]
  me?: { total_tickets?: number }
}

export default function RafflePage() {
  const { t } = useTranslation()
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<ActiveCampaign | null>(null)
  const [detailPrizes, setDetailPrizes] = useState<ApiRafflePrizeRow[] | null>(null)
  const [userTickets, setUserTickets] = useState(0)
  const [endMs, setEndMs] = useState(() => Date.now() + 7 * 24 * 60 * 60 * 1000)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const res = await playerFetch('/v1/raffles/active')
        const j = (await res.json()) as ActiveResp
        if (cancelled) return
        if (!res.ok || !j.active) {
          setActive(null)
          setDetailPrizes(null)
          setUserTickets(0)
          return
        }
        setActive(j.active)
        const end = j.active.end_at ? Date.parse(j.active.end_at) : NaN
        if (Number.isFinite(end)) {
          setEndMs(end)
        }
        const slug = j.active.slug
        const path = `/v1/raffles/${encodeURIComponent(slug)}`
        const dRes = isAuthenticated ? await apiFetch(path) : await playerFetch(path)
        if (!dRes.ok) {
          setDetailPrizes(null)
          setUserTickets(0)
          return
        }
        const d = (await dRes.json()) as DetailResp
        if (cancelled) return
        setDetailPrizes(Array.isArray(d.prizes) ? d.prizes : null)
        const tot = d.me?.total_tickets
        setUserTickets(typeof tot === 'number' && Number.isFinite(tot) ? tot : 0)
      } catch {
        if (!cancelled) {
          setActive(null)
          setDetailPrizes(null)
          setUserTickets(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [apiFetch, isAuthenticated])

  return (
    <div className="player-casino-max mx-auto px-4 pb-14 pt-6 sm:px-6 lg:pb-20 lg:pt-10">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
        <h1 className="m-0 text-2xl font-bold uppercase tracking-wide text-casino-foreground">{t('raffle.pageTitle')}</h1>

        {loading ? (
          <p className="m-0 text-sm text-casino-muted">{t('common.loading')}</p>
        ) : !active ? (
          <p className="m-0 text-sm text-casino-muted">{t('raffle.empty.noActive')}</p>
        ) : (
          <RaffleHeroSection endMs={endMs} userTickets={userTickets} />
        )}

        <RaffleHowItWorks />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RaffleRewardsCard />
          <RafflePurchasePanel />
        </div>

        <RafflePrizesGrid apiPrizes={detailPrizes} />
      </div>
    </div>
  )
}
