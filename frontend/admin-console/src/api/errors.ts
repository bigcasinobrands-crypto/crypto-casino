export type ApiErr = {
  code: string
  message: string
  status: number
}

export async function readApiError(res: Response): Promise<ApiErr | null> {
  try {
    const j = (await res.json()) as {
      error?: { code?: string; message?: string }
    }
    const c = j.error?.code
    if (c) {
      return {
        code: c,
        message: j.error?.message ?? '',
        status: res.status,
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function formatApiError(e: ApiErr | null, fallback: string): string {
  if (!e) return fallback
  if (e.message) return e.message
  return fallback
}
