/**
 * PassimPay hosted checkout (`payment.passimpay.io`) typically sets clickjacking headers
 * (X-Frame-Options / CSP frame-ancestors) so it cannot render inside a cross-origin iframe.
 * Opening a real popup window in the same user-gesture chain keeps UX close to an in-app sheet.
 */

const FEATURE_TARGET = 'passimpay_hosted_checkout'

function popupFeatures(): string {
  const margin = 24
  const w = Math.min(560, Math.max(360, window.screen.availWidth - margin))
  const h = Math.min(920, Math.max(560, window.screen.availHeight - margin))
  const left = Math.round((window.screen.availWidth - w) / 2)
  const top = Math.round((window.screen.availHeight - h) / 2)
  return [
    `popup=yes`,
    `width=${w}`,
    `height=${h}`,
    `left=${left}`,
    `top=${top}`,
    `scrollbars=yes`,
    `resizable=yes`,
    `noopener=yes`,
  ].join(',')
}

/** Call synchronously from a click handler before any await so Safari allows the popup. */
export function openPassimpayHostedBlankWindow(): Window | null {
  try {
    return window.open('about:blank', FEATURE_TARGET, popupFeatures())
  } catch {
    return null
  }
}

/** Navigate a popup opened via {@link openPassimpayHostedBlankWindow}. Returns false if unusable. */
export function navigatePassimpayHostedPopup(win: Window | null, url: string): boolean {
  if (!win || win.closed) return false
  try {
    win.location.replace(url)
    win.focus()
    return true
  } catch {
    try {
      win.close()
    } catch {
      /* ignore */
    }
    return false
  }
}

export function closePassimpayHostedPopup(win: Window | null): void {
  if (!win || win.closed) return
  try {
    win.close()
  } catch {
    /* ignore */
  }
}
