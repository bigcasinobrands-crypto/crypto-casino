/** Response shape for GET /v1/admin/analytics/traffic */

export type TrafficCountryRow = {
  iso2: string
  name: string
  sessions: number
  pct_of_total: number
  registrations: number
}

export type TrafficChannelRow = {
  channel: string
  sessions: number
  pct_of_total: number
  conv_rate_pct: number
}

export type SocialPlatformRow = {
  platform: string
  sessions: number
  pct_of_total: number
  top_ref_host?: string
}

export type ReferrerRow = {
  host: string
  category: string
  sessions: number
  pct_of_total: number
  top_landing_path?: string
}

export type UTMCampaignRow = {
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content?: string
  utm_term?: string
  sessions: number
}

export type LandingPageRow = {
  path: string
  sessions: number
  bounce_pct: number
}

export type TrafficTechnology = {
  mobile_pct: number
  desktop_pct: number
  tablet_pct: number
}

export type TrafficAnalyticsPayload = {
  period: string
  sessions_total: number
  unique_visitors: number
  new_visitors_pct: number
  avg_session_seconds: number
  countries: TrafficCountryRow[]
  channels: TrafficChannelRow[]
  social_platforms: SocialPlatformRow[]
  referrers: ReferrerRow[]
  utm_campaigns: UTMCampaignRow[]
  landing_pages: LandingPageRow[]
  technology: TrafficTechnology
  notes?: string
}

export function emptyTrafficAnalyticsPayload(period: string): TrafficAnalyticsPayload {
  return {
    period,
    sessions_total: 0,
    unique_visitors: 0,
    new_visitors_pct: 0,
    avg_session_seconds: 0,
    countries: [],
    channels: [],
    social_platforms: [],
    referrers: [],
    utm_campaigns: [],
    landing_pages: [],
    technology: { mobile_pct: 0, desktop_pct: 0, tablet_pct: 0 },
    notes: 'display_suppressed',
  }
}
