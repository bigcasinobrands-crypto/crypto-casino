import DOMPurify from 'dompurify'

/** Legal / CMS HTML shown in the player app — strict sanitization (OWASP). */
export function sanitizeLegalHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  })
}

/** Chat system/rain lines: only bold markup from our own highlightBold(). */
export function sanitizeChatRichLine(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['strong'],
    ALLOWED_ATTR: ['class'],
  })
}
