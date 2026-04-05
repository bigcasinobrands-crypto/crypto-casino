import { playerApiUrl } from './playerApiUrl'

/** Browser fetch to the player API with a per-request id (echoed by the server when possible). */
export function playerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', crypto.randomUUID())
  }
  return fetch(playerApiUrl(path), { ...init, headers })
}
