import { useMemo, type FC } from 'react'
import { useSiteContent } from '../hooks/useSiteContent'

type LegalPageProps = {
  contentKey: string
  fallbackTitle: string
}

const FALLBACK_BODY: Record<string, string> = {
  'legal.terms_of_service':
    '<p>Terms of Service content is not yet available. Please check back later or contact support.</p>',
  'legal.privacy_policy':
    '<p>Privacy Policy content is not yet available. Please check back later or contact support.</p>',
  'legal.responsible_gambling':
    '<p>Responsible Gambling content is not yet available. Please check back later or contact support.</p>',
  'legal.fairness':
    '<p>Fairness content is not yet available. Please check back later or contact support.</p>',
}

const LegalPage: FC<LegalPageProps> = ({ contentKey, fallbackTitle }) => {
  const { getContent, loading } = useSiteContent()

  const entry = getContent<{ title?: string; body?: string; updated_at?: string } | undefined>(contentKey)

  const title = entry?.title ?? fallbackTitle
  const body = entry?.body ?? FALLBACK_BODY[contentKey] ?? ''
  const updatedAt = entry?.updated_at

  const formattedDate = useMemo(() => {
    if (!updatedAt) return null
    try {
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(updatedAt))
    } catch {
      return updatedAt
    }
  }, [updatedAt])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <p className="text-sm text-casino-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 md:px-6 md:py-14">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-casino-foreground md:text-3xl">
        {title}
      </h1>
      {formattedDate && (
        <p className="mb-8 text-xs text-casino-muted">Last updated {formattedDate}</p>
      )}
      <article
        className="legal-prose text-sm leading-relaxed text-casino-muted [&_a]:text-casino-primary [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-casino-foreground [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-casino-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_p+p]:mt-4 [&_ul]:my-3"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </div>
  )
}

export default LegalPage
