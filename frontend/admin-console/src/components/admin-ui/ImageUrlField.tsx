import { useState } from 'react'
import { adminApiUrl } from '../../lib/adminApiUrl'
import { Field } from './Field'
import { adminInputCls } from './inputStyles'

const primaryBtn =
  'rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50 transition-colors'

function displayImageSrc(url: string): string {
  const t = url.trim()
  if (!t) return ''
  if (t.startsWith('//')) return `https:${t}`
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return adminApiUrl(t.startsWith('/') ? t : `/${t}`)
}

export function ImageUrlField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  uploadFile,
}: {
  id?: string
  label: string
  hint?: string
  value: string
  onChange: (url: string) => void
  disabled?: boolean
  /** When omitted, only URL entry is available (no file picker). */
  uploadFile?: (file: File) => Promise<string | null>
}) {
  const [uploading, setUploading] = useState(false)

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || disabled || !uploadFile) return
    setUploading(true)
    try {
      const url = await uploadFile(f)
      if (url) onChange(url)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="space-y-2">
        {value ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <img src={displayImageSrc(value)} alt="" className="max-h-40 w-full object-cover" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={id}
            className={adminInputCls}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
            disabled={disabled}
          />
          {uploadFile ? (
            <label className={`${primaryBtn} cursor-pointer ${disabled || uploading ? 'pointer-events-none opacity-50' : ''}`}>
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onPick(e)} disabled={disabled || uploading} />
              {uploading ? 'Uploading…' : 'Upload'}
            </label>
          ) : null}
        </div>
      </div>
    </Field>
  )
}
