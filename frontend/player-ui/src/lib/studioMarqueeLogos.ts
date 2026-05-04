/**
 * Static studio logos for the home marquee (`/public/studios/*.png`).
 * `forceWhiteFilter`: colored / black-matte assets → CSS white via brightness+invert; leave false for already-white marks.
 */
export type StudioMarqueeLogo = {
  id: string
  label: string
  /** `provider` query value for `/casino/games` — align with catalog `provider_system` where possible */
  providerQuery: string
  src: string
  forceWhiteFilter: boolean
}

export const STUDIO_MARQUEE_LOGOS: readonly StudioMarqueeLogo[] = [
  {
    id: 'bgaming',
    label: 'BGaming',
    providerQuery: 'bgaming',
    src: '/studios/bgaming.png',
    forceWhiteFilter: true,
  },
  {
    id: 'pragmatic-play',
    label: 'Pragmatic Play',
    providerQuery: 'pragmaticplay',
    src: '/studios/pragmatic-play.png',
    forceWhiteFilter: false,
  },
  {
    id: 'habanero',
    label: 'Habanero',
    providerQuery: 'habanero',
    src: '/studios/habanero.png',
    forceWhiteFilter: false,
  },
  {
    id: 'slotmill',
    label: 'Slotmill',
    providerQuery: 'slotmill',
    src: '/studios/slotmill.png',
    forceWhiteFilter: true,
  },
  {
    id: 'hacksaw',
    label: 'Hacksaw Gaming',
    providerQuery: 'hacksaw',
    src: '/studios/hacksaw.png',
    forceWhiteFilter: true,
  },
  {
    id: 'thunderkick',
    label: 'Thunderkick',
    providerQuery: 'thunderkick',
    src: '/studios/thunderkick.png',
    forceWhiteFilter: false,
  },
  {
    id: 'nolimit-city',
    label: 'Nolimit City',
    providerQuery: 'nolimitcity',
    src: '/studios/nolimit-city.png',
    forceWhiteFilter: true,
  },
  {
    id: 'playtech',
    label: 'Playtech',
    providerQuery: 'playtech',
    src: '/studios/playtech.png',
    forceWhiteFilter: true,
  },
  {
    id: 'avatar-ux',
    label: 'Avatar UX',
    providerQuery: 'avatarux',
    src: '/studios/avatar-ux.png',
    forceWhiteFilter: true,
  },
]
