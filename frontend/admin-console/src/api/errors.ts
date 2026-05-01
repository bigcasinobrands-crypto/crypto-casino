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
    return apiErrFromBody(j, res.status)
  } catch {
    /* ignore */
  }
  return null
}

/** Use when the response body was already parsed as JSON. */
export function apiErrFromBody(
  body: unknown,
  status: number,
): ApiErr | null {
  if (!body || typeof body !== 'object') return null
  const err = (body as { error?: { code?: string; message?: string } }).error
  const c = err?.code
  if (c) {
    return {
      code: c,
      message: err?.message ?? '',
      status,
    }
  }
  return null
}

export function formatApiError(e: ApiErr | null, fallback: string): string {
  if (!e) return fallback
  if (e.message) return e.message
  return fallback
}
