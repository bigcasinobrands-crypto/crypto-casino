import type { CSSProperties, ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> & {
  src: string
  size?: number
  /** Outline-style nav: white glyph on dark chip (skip for colorful brand logos). */
  monochrome?: boolean
}

/**
 * Raster/SVG asset from Pigmo CF or static host — keeps sizing aligned with stroke icons in `./icons.tsx`.
 */
export function PigmoAssetIcon({
  src,
  size = 20,
  className,
  style,
  monochrome = true,
  alt = '',
  decoding = 'async',
  referrerPolicy = 'strict-origin-when-cross-origin',
  ...rest
}: Props) {
  const filterStyle: CSSProperties | undefined = monochrome ? { filter: 'brightness(0) invert(1)', opacity: 0.92 } : undefined

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      referrerPolicy={referrerPolicy}
      decoding={decoding}
      draggable={false}
      className={['shrink-0 object-contain', className].filter(Boolean).join(' ')}
      style={{ ...filterStyle, ...style }}
      {...rest}
    />
  )
}
