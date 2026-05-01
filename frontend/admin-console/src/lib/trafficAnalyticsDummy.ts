import type { TrafficAnalyticsPayload } from './trafficAnalytics'

/** Same snapshot as core `trafficAnalyticsDemo()` for offline / dummy-dashboard mode. */
export function dummyTrafficAnalyticsPayload(period: string = '30d'): TrafficAnalyticsPayload {
  return {
    period,
    sessions_total: 128_400,
    unique_visitors: 84_200,
    new_visitors_pct: 38.2,
    avg_session_seconds: 246.5,
    countries: [
      { iso2: 'US', name: 'United States', sessions: 42_100, pct_of_total: 32.8, registrations: 1820 },
      { iso2: 'GB', name: 'United Kingdom', sessions: 12_400, pct_of_total: 9.7, registrations: 510 },
      { iso2: 'DE', name: 'Germany', sessions: 9800, pct_of_total: 7.6, registrations: 402 },
      { iso2: 'CA', name: 'Canada', sessions: 8600, pct_of_total: 6.7, registrations: 360 },
      { iso2: 'AU', name: 'Australia', sessions: 6200, pct_of_total: 4.8, registrations: 265 },
      { iso2: 'BR', name: 'Brazil', sessions: 5100, pct_of_total: 4.0, registrations: 310 },
      { iso2: 'FR', name: 'France', sessions: 4800, pct_of_total: 3.7, registrations: 198 },
      { iso2: 'IN', name: 'India', sessions: 4200, pct_of_total: 3.3, registrations: 890 },
      { iso2: 'NL', name: 'Netherlands', sessions: 3100, pct_of_total: 2.4, registrations: 128 },
      { iso2: 'SE', name: 'Sweden', sessions: 2800, pct_of_total: 2.2, registrations: 95 },
    ],
    channels: [
      { channel: 'Organic search', sessions: 35_200, pct_of_total: 27.4, conv_rate_pct: 4.1 },
      { channel: 'Direct / bookmark', sessions: 28_100, pct_of_total: 21.9, conv_rate_pct: 6.8 },
      { channel: 'Paid search', sessions: 22_400, pct_of_total: 17.4, conv_rate_pct: 5.2 },
      { channel: 'Affiliate / partner', sessions: 18_600, pct_of_total: 14.5, conv_rate_pct: 7.1 },
      { channel: 'Social', sessions: 12_800, pct_of_total: 10.0, conv_rate_pct: 2.4 },
      { channel: 'Email & CRM', sessions: 6200, pct_of_total: 4.8, conv_rate_pct: 8.9 },
      { channel: 'Display / programmatic', sessions: 5100, pct_of_total: 4.0, conv_rate_pct: 1.1 },
    ],
    social_platforms: [
      { platform: 'X (Twitter)', sessions: 4200, pct_of_total: 3.3, top_ref_host: 't.co' },
      { platform: 'Instagram', sessions: 3100, pct_of_total: 2.4, top_ref_host: 'l.instagram.com' },
      { platform: 'Facebook', sessions: 2800, pct_of_total: 2.2, top_ref_host: 'm.facebook.com' },
      { platform: 'Reddit', sessions: 1400, pct_of_total: 1.1, top_ref_host: 'reddit.com' },
      { platform: 'YouTube', sessions: 980, pct_of_total: 0.8, top_ref_host: 'youtube.com' },
      { platform: 'TikTok', sessions: 620, pct_of_total: 0.5, top_ref_host: 'tiktok.com' },
      { platform: 'Telegram', sessions: 410, pct_of_total: 0.3, top_ref_host: 't.me' },
    ],
    referrers: [
      { host: 'google.com', category: 'search', sessions: 31_200, pct_of_total: 24.3, top_landing_path: '/' },
      { host: 'bing.com', category: 'search', sessions: 4200, pct_of_total: 3.3, top_landing_path: '/promotions' },
      { host: 'duckduckgo.com', category: 'search', sessions: 1800, pct_of_total: 1.4, top_landing_path: '/' },
      {
        host: 'partner-casino.example',
        category: 'affiliate',
        sessions: 12_400,
        pct_of_total: 9.7,
        top_landing_path: '/r/partner-casino',
      },
      { host: 'streamer-hub.gg', category: 'affiliate', sessions: 6200, pct_of_total: 4.8, top_landing_path: '/r/stream' },
      {
        host: 'news.crypto.example',
        category: 'content',
        sessions: 2800,
        pct_of_total: 2.2,
        top_landing_path: '/blog/welcome-bonus',
      },
      { host: 't.co', category: 'social', sessions: 4100, pct_of_total: 3.2, top_landing_path: '/' },
      { host: 'reddit.com', category: 'social', sessions: 1400, pct_of_total: 1.1, top_landing_path: '/games' },
    ],
    utm_campaigns: [
      { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'mar_vip_reactivation', utm_content: 'hero_cta', sessions: 2400 },
      { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'brand_exact', utm_term: 'twox casino', sessions: 18_200 },
      { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'lookalike_depositors', sessions: 6200 },
      { utm_source: 'twitter', utm_medium: 'social', utm_campaign: 'launch_stream', sessions: 1800 },
      { utm_source: 'affiliate', utm_medium: 'cpa', utm_campaign: 'q1_partner_push', sessions: 9100 },
    ],
    landing_pages: [
      { path: '/', sessions: 45_200, bounce_pct: 42.1 },
      { path: '/games', sessions: 18_400, bounce_pct: 28.4 },
      { path: '/promotions', sessions: 12_100, bounce_pct: 35.2 },
      { path: '/register', sessions: 9800, bounce_pct: 18.6 },
      { path: '/blog/welcome-bonus', sessions: 4200, bounce_pct: 55.0 },
    ],
    technology: { mobile_pct: 62.4, desktop_pct: 35.1, tablet_pct: 2.5 },
    notes:
      'Synthetic analytics for dummy dashboard mode (no live API). Set VITE_ADMIN_DUMMY_DASHBOARD=false and run the core API to load real traffic_sessions.',
  }
}
