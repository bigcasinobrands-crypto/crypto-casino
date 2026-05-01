import { memo, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import type { GeographyObject } from 'react-simple-maps'
import type { TrafficCountryRow } from '../../lib/trafficAnalytics'

function useContainerContentWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setWidth(Math.max(0, Math.floor(w)))
    }
    measure()
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect.width
      if (cr != null) setWidth(Math.max(0, Math.floor(cr)))
      else measure()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** TopoJSON from world-atlas (countries, 110m resolution). */
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

function normalizeCountryKey(raw: string | undefined): string | null {
  if (!raw) return null
  return raw.trim().toLowerCase()
}

/** Natural Earth / world-atlas names do not always match marketing labels — map a few aliases. */
const NAME_ALIASES: Record<string, string> = {
  'united states of america': 'united states',
  usa: 'united states',
  'russian federation': 'russia',
  'korea, republic of': 'south korea',
  'korea, democratic people\'s republic of': 'north korea',
}

type Props = {
  countries: TrafficCountryRow[]
  /**
   * Reserved for layout hints (skeleton min-height). The SVG viewBox uses a height derived from
   * width so geoEqualEarth shows the full world without clipping the poles.
   */
  height?: number
}

/** Height/width ratio that keeps a full Equal Earth world inside the viewBox at our scale. */
const MAP_ASPECT = 0.58

const WorldSessionsMap: FC<Props> = ({ countries, height = 320 }) => {
  const [wrapRef, containerW] = useContainerContentWidth()
  const mapWidth = Math.max(260, containerW || 640)
  const mapHeight = Math.max(240, Math.round(mapWidth * MAP_ASPECT))

  const projectionConfig = useMemo(
    () => ({
      // Slightly conservative scale so land stays inside the viewBox (avoids top/bottom clip).
      scale: Math.max(108, mapWidth * 0.168),
    }),
    [mapWidth],
  )

  const { byName, maxSessions } = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of countries) {
      const k = normalizeCountryKey(c.name)
      if (k) m.set(k, c.sessions)
      const iso = c.iso2?.trim().toLowerCase()
      if (iso) m.set(iso, c.sessions)
    }
    const max = Math.max(1, ...countries.map((c) => c.sessions))
    return { byName: m, maxSessions: max }
  }, [countries])

  const fillForGeo = useMemo(() => {
    return (geo: GeographyObject) => {
      const props = geo.properties ?? {}
      const nameRaw =
        (props.name as string | undefined) ||
        (props.NAME as string | undefined) ||
        (props.admin as string | undefined)
      let key = normalizeCountryKey(nameRaw)
      if (key && NAME_ALIASES[key]) key = NAME_ALIASES[key]

      const iso =
        (props.iso_a2 as string | undefined) ||
        (props.ISO_A2 as string | undefined) ||
        (props.iso_3166_2 as string | undefined)
      const isoKey = iso?.trim().toLowerCase()

      let v = 0
      if (key && byName.has(key)) v = byName.get(key) ?? 0
      else if (isoKey && byName.has(isoKey)) v = byName.get(isoKey) ?? 0

      if (v <= 0) return 'var(--bs-secondary-bg-subtle, #e9ecef)'
      const t = v / maxSessions
      const r = Math.round(13 + t * 40)
      const g = Math.round(110 + t * 90)
      const b = Math.round(253 - t * 40)
      return `rgb(${r}, ${g}, ${b})`
    }
  }, [byName, maxSessions])

  return (
    <div ref={wrapRef} className="w-100 pt-1" style={{ minHeight: containerW ? undefined : height }}>
      {containerW > 0 ? (
        <ComposableMap
          projection="geoEqualEarth"
          projectionConfig={projectionConfig}
          width={mapWidth}
          height={mapHeight}
          className="d-block mx-auto world-sessions-map__svg"
          style={{ width: '100%', height: 'auto', maxWidth: '100%' }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo: GeographyObject) => {
                const props = geo.properties as Record<string, string | undefined>
                const label =
                  props?.name || props?.NAME || props?.admin || props?.iso_a2 || 'Unknown'
                const fill = fillForGeo(geo)
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="var(--bs-border-color, #dee2e6)"
                    strokeWidth={0.35}
                    title={label}
                    style={{
                      default: { outline: 'none' },
                      hover: { fill: fill, outline: 'none', filter: 'brightness(0.92)' },
                      pressed: { outline: 'none' },
                    }}
                  />
                )
              })
            }
          </Geographies>
        </ComposableMap>
      ) : (
        <div className="rounded bg-body-secondary" style={{ minHeight: mapHeight }} aria-hidden />
      )}
      <p className="text-secondary small mt-3 mb-0 px-sm-1">
        Session intensity by country (darker / more blue = higher share). Hover a region for its label.
      </p>
    </div>
  )
}

export default memo(WorldSessionsMap)
