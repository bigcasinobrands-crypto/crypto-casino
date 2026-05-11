/** Clears all key/value storage for this origin (admin SPA). Does not clear httpOnly cookies. */
export function clearBrowserSiteData(): void {
  try {
    localStorage.clear()
  } catch {
    /* private mode / blocked */
  }
  try {
    sessionStorage.clear()
  } catch {
    /* same */
  }
}
