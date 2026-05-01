/**
 * Permissions-Policy `allow` list for third-party game iframes (slots + live).
 * Live dealer streams require camera/microphone or the stage often stays black after load.
 */
export const GAME_IFRAME_ALLOW =
  'accelerometer; autoplay; camera *; clipboard-write; encrypted-media; fullscreen; gamepad; gyroscope; microphone *; payment; picture-in-picture; web-share'
