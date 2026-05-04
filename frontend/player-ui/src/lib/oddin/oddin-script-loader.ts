const SCRIPT_ATTR = 'data-oddin-bifrost-script'

export type LoadOddinScriptResult =
  | { ok: true }
  | { ok: false; message: string }

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
          message: 'Timed out waiting for Oddin Bifrost (window.oddin.buildBifrost missing).',
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

  if (window.oddin?.buildBifrost) {
    return { ok: true }
  }

  let el = findInjectedScript(scriptUrl)
  if (!el) {
    el = document.createElement('script')
    el.async = true
    el.src = scriptUrl
    el.setAttribute(SCRIPT_ATTR, '1')
    el.crossOrigin = 'anonymous'
    document.head.appendChild(el)
  }

  const errPromise = new Promise<LoadOddinScriptResult>((resolve) => {
    el?.addEventListener(
      'error',
      () => resolve({ ok: false, message: 'Failed to load Oddin script (network or CSP).' }),
      { once: true },
    )
  })

  return Promise.race([waitForBuildBifrost(timeoutMs), errPromise])
}
