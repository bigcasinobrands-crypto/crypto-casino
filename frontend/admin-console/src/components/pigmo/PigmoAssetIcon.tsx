import type { CSSProperties, ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height'> & {
  src: string
  size?: number
  /** Match player shell: white glyph for dark AdminLTE chrome. */
  monochrome?: boolean
}

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
  const filterStyle: CSSProperties | undefined = monochrome
    ? { filter: 'brightness(0) invert(1)', opacity: 0.9 }
    : undefined

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      referrerPolicy={referrerPolicy}
      decoding={decoding}
      draggable={false}
      className={['flex-shrink-0 object-contain', className].filter(Boolean).join(' ')}
      style={{ ...filterStyle, ...style }}
      {...rest}
    />
  )
}
