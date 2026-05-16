/**
 * Vercel Edge: proxy same-origin `/v1/*` to the Go core API so POST/PATCH reach the server.
 *
 * Without this, `vercel.json` rewrites all paths to `index.html`, which responds with 405 for writes.
 *
 * Set `CORE_API_ORIGIN` in the Vercel project (Production + Preview) to your API base, e.g.
 * `https://your-core.onrender.com` (no trailing slash). Alternatively skip the proxy and build with
 * `VITE_ADMIN_API_ORIGIN` so the browser calls the API host directly.
 */
export const config = {
  matcher: ['/v1/:path*'],
}

export default async function middleware(request: Request): Promise<Response> {
  const upstreamBase = process.env.CORE_API_ORIGIN?.trim().replace(/\/$/, '')
  if (!upstreamBase) {
    return new Response(
      JSON.stringify({
        error: 'admin_proxy_unconfigured',
        message:
          'Set CORE_API_ORIGIN on this Vercel project to your core API HTTPS origin (same value you would use for VITE_ADMIN_API_ORIGIN), or rebuild with VITE_ADMIN_API_ORIGIN so requests go to the API directly.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    )
  }

  let upstreamHost: string
  try {
    upstreamHost = new URL(upstreamBase).host
  } catch {
    return new Response(
      JSON.stringify({
        error: 'admin_proxy_invalid_origin',
        message: 'CORE_API_ORIGIN is not a valid absolute URL.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    )
  }

  const url = new URL(request.url)
  const targetUrl = `${upstreamBase}${url.pathname}${url.search}`

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('Host', upstreamHost)
  headers.set('X-Forwarded-Host', url.host)
  headers.set('X-Forwarded-Proto', url.protocol.replace(/:$/, ''))

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'follow',
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }

  try {
    return await fetch(targetUrl, init)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: 'upstream_fetch_failed', message: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }
}
