const SCRIPT_ATTR = 'data-oddin-bifrost-script'

/** Last successfully loaded script href (avoids re-injecting the same URL; supports env switch without full page reload). */
let lastLoadedOddinScriptHref: string | null = null

export type LoadOddinScriptResult =
  | { ok: true }
  | { ok: false; message: string }

function scriptHref(scriptUrl: string): string | null {
  try {
    return new URL(scriptUrl, window.location.href).href
  } catch {
    return null
  }
}

function findInjectedScript(scriptUrl: string): HTMLScriptElement | null {
  const nodes = document.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`)
  for (const n of nodes) {
    try {
      if (n.src === new URL(scriptUrl, window.location.href).href) return n
    } catch {
      if (n.getAttribute('src') === scriptUrl) return n
    }
  }
  return null
}

function waitForBuildBifrost(timeoutMs: number): Promise<LoadOddinScriptResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      if (typeof window !== 'undefined' && window.oddin?.buildBifrost) {
        resolve({ ok: true })
        return
      }
      if (Date.now() - start > timeoutMs) {
        resolve({
          ok: false,
          message: 'Timed out waiting for Oddin (window.oddin.buildBifrost missing).',
        })
        return
      }
      window.setTimeout(tick, 30)
    }
    tick()
  })
}

/**
 * Injects `scriptUrl` once, resolves when `window.oddin.buildBifrost` exists.
 * Browser-only; never call during SSR.
 */
export async function loadOddinScript(scriptUrl: string, timeoutMs = 25_000): Promise<LoadOddinScriptResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, message: 'Oddin script can only load in the browser.' }
  }
  if (!scriptUrl.trim()) {
    return { ok: false, message: 'Missing Oddin script URL.' }
  }

  const href = scriptHref(scriptUrl.trim())
  if (!href) {
    return { ok: false, message: 'Invalid Oddin script URL.' }
  }

  if (window.oddin?.buildBifrost && lastLoadedOddinScriptHref === href) {
    return { ok: true }
  }

  if (lastLoadedOddinScriptHref !== null && lastLoadedOddinScriptHref !== href) {
    document.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`).forEach((s) => s.remove())
    try {
      delete (window as unknown as { oddin?: unknown }).oddin
    } catch {
      /* ignore */
    }
    lastLoadedOddinScriptHref = null
  }

  let el = findInjectedScript(scriptUrl)
  if (!el) {
    el = document.createElement('script')
    el.async = true
    el.src = scriptUrl.trim()
    el.setAttribute(SCRIPT_ATTR, '1')
    // Do not set crossOrigin: Oddin's CDN may not send ACAO; that would block execution in strict CORS mode.
    document.head.appendChild(el)
  }

  const errPromise = new Promise<LoadOddinScriptResult>((resolve) => {
    el?.addEventListener(
      'error',
      () => resolve({ ok: false, message: 'Failed to load Oddin script (network or CSP).' }),
      { once: true },
    )
  })

  const result = await Promise.race([waitForBuildBifrost(timeoutMs), errPromise])
  if (result.ok) {
    lastLoadedOddinScriptHref = href
  }
  return result
}
