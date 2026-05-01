declare module 'react-simple-maps' {
  import type * as React from 'react'

  export interface GeographyObject {
    rsmKey: string
    properties: Record<string, string | number | undefined>
    [key: string]: unknown
  }

  export const ComposableMap: React.ComponentType<React.PropsWithChildren<Record<string, unknown>>>
  export const Geographies: React.ComponentType<{
    geography: string
    children: (o: { geographies: GeographyObject[] }) => React.ReactNode
  }>
  export const Geography: React.ComponentType<
    Record<string, unknown> & {
      geography?: GeographyObject
    }
  >
}
