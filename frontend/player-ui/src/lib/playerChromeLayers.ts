/**
 * Centralized stacking for full-screen overlays vs the casino shell.
 *
 * Approximate stack: main scroll `z-[200]`, operational banner `z-[210]`, headers ~`211`,
 * bottom nav `205` (height `--casino-mobile-nav-offset` in `casino-shell.css`), wallet dropdown backdrops `199`/`219`, game search `z-[240]`,
 * chat `235`–`236`, mobile menu `z-[260]`, initial boot `z-[400]`.
 *
 * Blocking modals (auth, wallet flow, etc.) must use {@link PLAYER_MODAL_OVERLAY_Z} so they
 * never paint under lobby tiles or headers.
 *
 * Full-viewport boot / preload (covers entire app on hard refresh until shell is ready)
 * must sit above modals so no chrome flashes through.
 */
export const PLAYER_BOOT_OVERLAY_Z = 'z-[400]'
export const PLAYER_MODAL_OVERLAY_Z = 'z-[270]'
