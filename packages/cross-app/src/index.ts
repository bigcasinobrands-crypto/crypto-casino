export {
  type CrossAppViteEnv,
  DEFAULT_ADMIN_DEV_ORIGIN,
  DEFAULT_PLAYER_DEV_ORIGIN,
  resolveAdminAppOrigin,
  resolvePlayerAppOrigin,
} from './env'
export { adminAppHref, playerAppHref } from './urls'
export {
  CROSS_APP_MESSAGE_CHANNEL,
  type CrossAppPayload,
  installPlayerCrossAppBridge,
  isCrossAppEnvelope,
  isCrossAppPayload,
  postCrossApp,
} from './bridge'
