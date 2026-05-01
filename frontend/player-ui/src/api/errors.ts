export type ApiErr = {
  code: string
  message: string
  status: number
}

/** When the body is HTML or empty, still return a structured error with real HTTP status (avoids misleading HTTP 0 toasts). */
export async function apiErrFromResponse(
  res: Response,
  fallbackMessage?: string,
): Promise<ApiErr> {
  const parsed = await readApiError(res)
  if (parsed) return parsed
  const msg =
    fallbackMessage?.trim() ||
    (res.status ? `Request failed (HTTP ${res.status}).` : 'Request failed.')
  return {
    code: 'http_error',
    message: msg,
    status: res.status,
  }
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
