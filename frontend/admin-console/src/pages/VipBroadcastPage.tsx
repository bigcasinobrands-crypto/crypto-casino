import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type VipTierRow = {
  id: number
  name: string
}

const inputCls = 'form-control form-control-sm'
const labelCls = 'form-label small mb-1'

export default function VipBroadcastPage() {
  const { apiFetch, role } = useAdminAuth()
  const [tiers, setTiers] = useState<VipTierRow[]>([])
  const [tiersLoading, setTiersLoading] = useState(true)
  const [broadcastTierID, setBroadcastTierID] = useState<number | null>(null)
  const [broadcastTitle, setBroadcastTitle] = useState('')
  const [broadcastBody, setBroadcastBody] = useState('')
  const [broadcastRecipients, setBroadcastRecipients] = useState<number | null>(null)
  const [broadcastLoading, setBroadcastLoading] = useState(false)

  const canEdit = role === 'superadmin'

  const loadTiers = useCallback(async () => {
    setTiersLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/tiers')
      if (!res.ok) {
        toast.error(`Could not load tiers (${res.status})`)
        setTiers([])
        return
      }
      const j = (await res.json()) as { tiers?: VipTierRow[] }
      const list = Array.isArray(j.tiers) ? j.tiers : []
      setTiers(list)
    } catch {
      toast.error('Network error loading VIP tiers')
      setTiers([])
    } finally {
      setTiersLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadTiers()
  }, [loadTiers])

  useEffect(() => {
    if (broadcastTierID == null && tiers.length > 0) {
      setBroadcastTierID(tiers[0].id)
    }
  }, [broadcastTierID, tiers])

  const previewBroadcastAudience = useCallback(async () => {
    if (!broadcastTierID) return
    try {
      const res = await apiFetch(`/v1/admin/vip/messages/preview?tier_id=${broadcastTierID}`)
      if (!res.ok) return
      const j = (await res.json()) as { recipients?: number }
      setBroadcastRecipients(j.recipients ?? 0)
    } catch {
      setBroadcastRecipients(null)
    }
  }, [apiFetch, broadcastTierID])

  const sendBroadcast = async (dryRun: boolean) => {
    if (!broadcastTierID || !canEdit) return
    setBroadcastLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/messages/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier_id: broadcastTierID,
          title: broadcastTitle,
          body: broadcastBody,
          dry_run: dryRun,
        }),
      })
      if (!res.ok) {
        toast.error(`Broadcast failed (${res.status})`)
        return
      }
      const j = (await res.json()) as { recipients?: number; dry_run?: boolean }
      toast.success(`${j.dry_run ? 'Dry run' : 'Sent'} to ${j.recipients ?? 0} recipients`)
      setBroadcastRecipients(j.recipients ?? 0)
    } catch {
      toast.error('Broadcast request failed')
    } finally {
      setBroadcastLoading(false)
    }
  }

  return (
    <div>
      <PageMeta title="VIP — Player messaging" description="Tier-targeted in-app and email notifications." />
      <PageBreadcrumb
        pageTitle="Player messaging"
        trail={[{ label: 'Engagement' }, { label: 'VIP', to: '/engagement/vip' }]}
      />
      <p className="text-secondary small mb-3">
        Send tier-targeted announcements. Recipients are players currently assigned to the selected VIP tier.
      </p>

      {tiersLoading ? (
        <p className="text-secondary small">Loading tiers…</p>
      ) : tiers.length === 0 ? (
        <p className="text-secondary small">No VIP tiers configured yet. Create tiers on the Program page first.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-body p-3 dark:border-gray-700">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <h2 className="h6 mb-0">Tier-targeted VIP broadcast</h2>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => void previewBroadcastAudience()}
            >
              Preview recipients
            </button>
          </div>
          <p className="small text-secondary mb-3">Sends in-app notifications and queues outbound email events.</p>
          <div className="row g-2">
            <div className="col-md-3">
              <label className={labelCls}>Tier</label>
              <select
                className={inputCls}
                value={broadcastTierID ?? ''}
                onChange={(e) => setBroadcastTierID(Number(e.target.value) || null)}
              >
                {tiers.map((t) => (
                  <option key={`bc-${t.id}`} value={t.id}>
                    {t.name} (#{t.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-9">
              <label className={labelCls}>Title</label>
              <input className={inputCls} value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} />
            </div>
            <div className="col-12">
              <label className={labelCls}>Message</label>
              <textarea
                className={inputCls}
                rows={3}
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2 d-flex flex-wrap align-items-center gap-2">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={!canEdit || broadcastLoading}
              onClick={() => void sendBroadcast(true)}
            >
              Dry run send
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canEdit || broadcastLoading}
              onClick={() => void sendBroadcast(false)}
            >
              {broadcastLoading ? 'Sending…' : 'Send now'}
            </button>
            {broadcastRecipients != null ? (
              <span className="small text-secondary">Recipients: {broadcastRecipients}</span>
            ) : null}
          </div>
          {!canEdit ? (
            <p className="small text-secondary mt-2 mb-0">Superadmin role required to send broadcasts.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
