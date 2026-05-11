import { useCallback, useEffect, useState } from 'react'

export type OperationalFlags = {
  maintenance_mode?: boolean
  /** True only when MAINTENANCE_MODE env is set on the API process (informational). */
  maintenance_mode_env?: boolean
  /** RFC3339 scheduled maintenance end from site_settings (mirrors player `/health/operational`). */
  maintenance_until?: string | null
  /** Runtime payment/chat flags (mirrors `payment_ops_flags` + `chat_settings`). */
  deposits_enabled?: boolean
  withdrawals_enabled?: boolean
  real_play_enabled?: boolean
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
  chat_enabled?: boolean
  disable_game_launch?: boolean
  blueocean_launch_mode?: string
  bonus_max_bet_violations_auto_forfeit?: number
}

export function useOperationalFlags(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
): { flags: OperationalFlags | null; err: string | null; reload: () => Promise<OperationalFlags | null> } {
  const [flags, setFlags] = useState<OperationalFlags | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<OperationalFlags | null> => {
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/system/operational-flags')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        return null
      }
      const j = (await res.json()) as OperationalFlags
      setFlags(j)
      return j
    } catch {
      setErr('network')
      return null
    }
  }, [apiFetch])

  useEffect(() => {
    void reload()
  }, [reload])

  return { flags, err, reload }
}
