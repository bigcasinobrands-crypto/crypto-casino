import { useCallback, useEffect, useState } from 'react'

export type OperationalFlags = {
  maintenance_mode?: boolean
  disable_game_launch?: boolean
  blueocean_launch_mode?: string
  bonus_max_bet_violations_auto_forfeit?: number
}

export function useOperationalFlags(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
): { flags: OperationalFlags | null; err: string | null; reload: () => Promise<void> } {
  const [flags, setFlags] = useState<OperationalFlags | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setErr(null)
    try {
      const res = await apiFetch('/v1/admin/system/operational-flags')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        return
      }
      const j = (await res.json()) as OperationalFlags
      setFlags(j)
    } catch {
      setErr('network')
    }
  }, [apiFetch])

  useEffect(() => {
    void reload()
  }, [reload])

  return { flags, err, reload }
}
