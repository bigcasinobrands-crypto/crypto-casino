import { useMemo, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSiteContent } from '../hooks/useSiteContent'
import { getLegalFallbackBody } from '../legal/getLegalFallbackBody'
import { sanitizeLegalHtml } from '../lib/sanitizeHtml'

type LegalPageProps = {
  contentKey: string
  fallbackTitle: string
}

const TITLE_KEYS: Record<string, string> = {
  'legal.terms_of_service': 'legal.pageTitle.terms',
  'legal.privacy_policy': 'legal.pageTitle.privacy',
  'legal.responsible_gambling': 'legal.pageTitle.responsible',
  'legal.fairness': 'legal.pageTitle.aml',
}

const LegalPage: FC<LegalPageProps> = ({ contentKey, fallbackTitle }) => {
  const { i18n, t } = useTranslation()
  const { getContent, loading } = useSiteContent()

  const entry = getContent<{ title?: string; body?: string; updated_at?: string } | undefined>(contentKey)

  const titleKey = TITLE_KEYS[contentKey]
  const title = entry?.title ?? (titleKey ? t(titleKey, { defaultValue: fallbackTitle }) : fallbackTitle)
  const body = entry?.body ?? getLegalFallbackBody(contentKey, i18n.language)
  const updatedAt = entry?.updated_at

  const dateLocale = i18n.language === 'fr-CA' ? 'fr-CA' : 'en-US'

  const formattedDate = useMemo(() => {
    if (!updatedAt) return null
    try {
      return new Intl.DateTimeFormat(dateLocale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date(updatedAt))
    } catch {
      return updatedAt
    }
  }, [updatedAt, dateLocale])

  const safeBody = useMemo(() => sanitizeLegalHtml(body), [body])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <p className="text-sm text-casino-muted">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="player-casino-max max-w-3xl px-4 py-10 sm:px-5 md:px-6 md:py-14 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-casino-foreground md:text-3xl">
        {title}
      </h1>
      {formattedDate ? (
        <p className="mb-8 text-xs text-casino-muted">
          {t('legal.lastUpdatedLine', { date: formattedDate })}
        </p>
      ) : null}
      <article
        className="legal-prose text-sm leading-relaxed text-casino-muted [&_a]:text-casino-primary [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-casino-foreground [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-casino-foreground [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_p+p]:mt-4 [&_ul]:my-3"
        dangerouslySetInnerHTML={{ __html: safeBody }}
      />
    </div>
  )
}

export default LegalPage
