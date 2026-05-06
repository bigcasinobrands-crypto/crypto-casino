import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { useAdminAuth } from '../authContext'
import { adminApiUrl } from '../lib/adminApiUrl'
import {
  addHomepagePromoTile,
  addHomepageStudio,
  getBannerPromos,
  getCMSActivityLog,
  getContentPageByRoute,
  getEditableContentPages,
  getFaqItems,
  getFooterAndNavLinks,
  getHomepageContentModel,
  getPolicyPages,
  publishContentChanges,
  publishPolicyVersion,
  saveContentDraft,
  updateBannerPromo,
  updateFaqItem,
  updateFooterOrNavLink,
  updateHomepagePromoTile,
  updateHomepageRaffleTile,
  updateHomepageStudio,
  updatePageSection,
  updatePolicyContent,
  type CMSActivityLogItem,
  type CMSBanner,
  type CMSFaq,
  type CMSNavLink,
  type CMSPage,
  type CMSPolicyPage,
  type CMSSection,
  type CMSSectionField,
  type HomeHeroTile,
  type HomepageContentModel,
  type HomeRaffleTile,
  type HomeStudioItem,
} from '../services/contentCmsService'

type CmsTab =
  | 'pages'
  | 'editor'
  | 'policies'
  | 'homepage'
  | 'durability'
  | 'banners'
  | 'faq'
  | 'footer-nav'
  | 'media'
  | 'activity'

type ContentHealthSummary = {
  content_keys: number
  upload_assets_stored: number
  upload_refs_checked: number
  broken_upload_refs: number
  blob_refs_detected: number
  missing_critical_keys: string[]
  issues: Array<{ key: string; reason: string; preview?: string }>
}

function statusBadgeClass(status: string): string {
  if (status === 'published' || status === 'active') return 'text-bg-success'
  if (status === 'review' || status === 'scheduled') return 'text-bg-warning'
  if (status === 'paused') return 'text-bg-secondary'
  return 'text-bg-dark'
}

function fieldValueAsString(value: string | boolean): string {
  return typeof value === 'string' ? value : value ? 'true' : 'false'
}

function cmsPreviewImageUrl(value: string): string {
  const raw = value.trim()
  if (!raw || raw.startsWith('blob:')) return ''
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      const isHttpsApp = typeof window !== 'undefined' && window.location.protocol === 'https:'
      if (parsed.protocol === 'http:' && isHttpsApp) {
        return `https://${parsed.host}${parsed.pathname}${parsed.search || ''}`
      }
      return raw
    } catch {
      return raw
    }
  }
  if (raw.startsWith('//')) return raw
  const normalized = raw.startsWith('v1/')
    ? `/${raw}`
    : raw.startsWith('/uploads/')
      ? `/v1${raw}`
      : raw.startsWith('uploads/')
        ? `/v1/${raw}`
        : raw.startsWith('/')
          ? raw
          : `/${raw}`
  return adminApiUrl(normalized)
}

function normalizeCmsAssetRef(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  if (raw.startsWith('blob:')) return raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      const marker = '/v1/uploads/'
      const markerIdx = parsed.pathname.indexOf(marker)
      if (markerIdx >= 0) {
        return `${parsed.pathname.slice(markerIdx)}${parsed.search || ''}`
      }
      return raw
    } catch {
      return raw
    }
  }
  if (raw.startsWith('/uploads/')) return `/v1${raw}`
  if (raw.startsWith('uploads/')) return `/v1/${raw}`
  if (raw.startsWith('v1/uploads/')) return `/${raw}`
  return raw
}

function ImageUploadField({
  id,
  value,
  onChange,
  onUploadFile,
}: {
  id: string
  value: string
  onChange: (next: string) => void | Promise<void>
  onUploadFile: (file: File) => Promise<string | null>
}) {
  const previewSrc = cmsPreviewImageUrl(value)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const uploadedUrl = await onUploadFile(file)
    if (!uploadedUrl) return
    await onChange(uploadedUrl)
  }

  return (
    <div className="d-flex flex-column gap-1">
      <input
        className="form-control form-control-sm"
        value={value}
        onChange={(event) => void onChange(event.target.value)}
      />
      <input
        id={id}
        type="file"
        accept="image/*"
        className="form-control form-control-sm"
        onChange={(event) => void handleFileChange(event)}
      />
      {previewSrc ? (
        <img
          src={previewSrc}
          alt="Uploaded content preview"
          className="rounded border"
          style={{ maxHeight: 90, maxWidth: 220, objectFit: 'cover' }}
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <small className="text-body-secondary">No resolvable preview yet. Upload an image to generate a persisted URL.</small>
      )}
    </div>
  )
}

export default function ContentCmsPage() {
  const { apiFetch } = useAdminAuth()
  const [activeTab, setActiveTab] = useState<CmsTab>('homepage')
  const [pages, setPages] = useState<CMSPage[]>([])
  const [policies, setPolicies] = useState<CMSPolicyPage[]>([])
  const [activity, setActivity] = useState<CMSActivityLogItem[]>([])
  const [banners, setBanners] = useState<CMSBanner[]>([])
  const [faqItems, setFaqItems] = useState<CMSFaq[]>([])
  const [links, setLinks] = useState<CMSNavLink[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedRoute, setSelectedRoute] = useState('/casino/games')
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [pageDraft, setPageDraft] = useState<CMSPage | null>(null)
  const [policyId, setPolicyId] = useState('')
  const [policyDraft, setPolicyDraft] = useState<CMSPolicyPage | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [mediaPath, setMediaPath] = useState('/assets/hero/main-banner.png')
  const [homepageModel, setHomepageModel] = useState<HomepageContentModel | null>(null)
  const [authDesktopVisualImage, setAuthDesktopVisualImage] = useState('/auth-side-visual.png')
  const [promoAutoplayEnabled, setPromoAutoplayEnabled] = useState(true)
  const [promoAutoplayMs, setPromoAutoplayMs] = useState(5000)
  const [contentHealth, setContentHealth] = useState<ContentHealthSummary | null>(null)
  const [contentHealthOk, setContentHealthOk] = useState<boolean | null>(null)
  const [contentHealthLoading, setContentHealthLoading] = useState(false)

  async function refreshAll() {
    const [pageList, policyList, activityList, bannerList, faqList, navLinks] =
      await Promise.all([
        getEditableContentPages(),
        getPolicyPages(),
        getCMSActivityLog(),
        getBannerPromos(),
        getFaqItems(),
        getFooterAndNavLinks(),
      ])
    const home = await getHomepageContentModel()
    setPages(pageList)
    setPolicies(policyList)
    setActivity(activityList)
    setBanners(bannerList)
    setFaqItems(faqList)
    setLinks(navLinks)
    setHomepageModel(home)
    try {
      const authVisualResponse = await apiFetch('/v1/admin/content/auth_desktop_visual_image')
      if (authVisualResponse.ok) {
        const payload = (await authVisualResponse.json()) as { content?: string }
        if (typeof payload.content === 'string' && payload.content.trim()) {
          setAuthDesktopVisualImage(payload.content)
        }
      }
    } catch {
      // Keep fallback image path when API key does not exist yet.
    }
    try {
      const settingsResponse = await apiFetch('/v1/admin/content/hero_slides_settings')
      if (settingsResponse.ok) {
        const payload = (await settingsResponse.json()) as {
          content?: { autoplay_enabled?: boolean; autoplay_ms?: number }
        }
        const content = payload.content
        if (content && typeof content === 'object') {
          setPromoAutoplayEnabled(content.autoplay_enabled !== false)
          const rawMs = Number(content.autoplay_ms ?? 5000)
          const clampedMs = Number.isFinite(rawMs) ? Math.max(1500, Math.min(30000, Math.round(rawMs))) : 5000
          setPromoAutoplayMs(clampedMs)
        }
      }
    } catch {
      // Keep defaults when hero settings key does not exist yet.
    }
    if (!policyId && policyList.length > 0) setPolicyId(policyList[0].id)
  }

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await refreshAll()
      setLoading(false)
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      const page = await getContentPageByRoute(selectedRoute)
      setPageDraft(page)
      if (page && page.sections.length > 0) {
        setSelectedSectionId(page.sections[0].id)
      } else {
        setSelectedSectionId('')
      }
    })()
  }, [selectedRoute])

  useEffect(() => {
    const next = policies.find((p) => p.id === policyId) ?? null
    setPolicyDraft(next ? { ...next } : null)
  }, [policyId, policies])

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((p) => p.name.toLowerCase().includes(q) || p.route.toLowerCase().includes(q))
  }, [pages, query])

  const selectedSection: CMSSection | null = useMemo(() => {
    if (!pageDraft) return null
    return pageDraft.sections.find((section) => section.id === selectedSectionId) ?? null
  }, [pageDraft, selectedSectionId])

  async function handleUpdateField(field: CMSSectionField, value: string | boolean) {
    if (!pageDraft || !selectedSection) return
    const updated = await updatePageSection(pageDraft.route, selectedSection.id, [{ id: field.id, value }])
    if (!updated) return
    setPageDraft(updated)
    setPages((prev) => prev.map((p) => (p.route === updated.route ? updated : p)))
    setMessage(`Updated ${selectedSection.title} field: ${field.label}`)
  }

  async function handleSaveDraft() {
    if (!pageDraft) return
    const result = await saveContentDraft(pageDraft.route)
    if (!result.ok) return
    setMessage(`Draft saved for ${pageDraft.name}`)
    await refreshAll()
  }

  async function handlePublishPage() {
    if (!pageDraft) return
    const result = await publishContentChanges(pageDraft.route)
    if (!result.ok) return
    setMessage(`Published ${pageDraft.name}`)
    await refreshAll()
  }

  async function handleRevertPage() {
    if (!pageDraft) return
    const page = await getContentPageByRoute(pageDraft.route)
    setPageDraft(page)
    setMessage(`Reverted local edits for ${pageDraft.name}`)
  }

  async function handlePolicyFieldChange(
    field: keyof Pick<CMSPolicyPage, 'title' | 'effectiveDate' | 'version' | 'jurisdiction' | 'body' | 'changeSummary'>,
    value: string,
  ) {
    if (!policyDraft) return
    const updated = await updatePolicyContent(policyDraft.id, { [field]: value })
    if (!updated) return
    setPolicyDraft(updated)
    setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    setMessage(`Updated ${updated.title}`)
  }

  async function handlePolicyPublish() {
    if (!policyDraft) return
    const updated = await publishPolicyVersion(policyDraft.id, {
      changeSummary: policyDraft.changeSummary || 'Content update',
      effectiveDate: policyDraft.effectiveDate,
      version: policyDraft.version,
    })
    if (!updated) return
    setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    setPolicyDraft(updated)
    setMessage(`Published ${updated.title} ${updated.version}`)
    await refreshAll()
  }

  async function handleBannerUpdate(
    banner: CMSBanner,
    key: keyof Pick<CMSBanner, 'text' | 'image' | 'ctaLabel' | 'ctaLink' | 'placement' | 'status' | 'startDate' | 'endDate'>,
    value: string,
  ) {
    const updated = await updateBannerPromo(banner.id, { [key]: value })
    if (!updated) return
    setBanners((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    setMessage(`Updated banner: ${updated.label}`)
    await refreshAll()
  }

  async function handleFaqUpdate(faq: CMSFaq, key: keyof CMSFaq, value: string | boolean | number) {
    const updated = await updateFaqItem(faq.id, { [key]: value })
    if (!updated) return
    setFaqItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    setMessage(`Updated FAQ: ${updated.question}`)
    await refreshAll()
  }

  async function handleLinkUpdate(link: CMSNavLink, key: keyof Pick<CMSNavLink, 'label' | 'href'>, value: string) {
    const updated = await updateFooterOrNavLink(link.id, { [key]: value })
    if (!updated) return
    setLinks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    setMessage(`Updated ${updated.group} link: ${updated.label}`)
    await refreshAll()
  }

  async function handleUpdateRaffleField(field: keyof HomeRaffleTile, value: string | boolean) {
    const updated = await updateHomepageRaffleTile({ [field]: value })
    setHomepageModel((prev) => (prev ? { ...prev, raffleTile: updated } : prev))
    setMessage(`Updated raffle tile field: ${field}`)
  }

  async function handleUpdatePromoTile(tile: HomeHeroTile, field: keyof HomeHeroTile, value: string | boolean) {
    const updated = await updateHomepagePromoTile(tile.id, { [field]: value })
    if (!updated) return
    setHomepageModel((prev) =>
      prev
        ? { ...prev, promoTiles: prev.promoTiles.map((item) => (item.id === tile.id ? updated : item)) }
        : prev,
    )
    setMessage(`Updated promo tile: ${tile.title}`)
  }

  async function handleAddPromoTile() {
    const created = await addHomepagePromoTile()
    setHomepageModel((prev) => (prev ? { ...prev, promoTiles: [...prev.promoTiles, created] } : prev))
    setMessage(`Added new hero tile: ${created.title}`)
  }

  async function handleUpdateStudio(studio: HomeStudioItem, field: keyof HomeStudioItem, value: string | boolean | number) {
    const updated = await updateHomepageStudio(studio.id, { [field]: value })
    if (!updated) return
    setHomepageModel((prev) =>
      prev
        ? { ...prev, studios: prev.studios.map((item) => (item.id === studio.id ? updated : item)) }
        : prev,
    )
    setMessage(`Updated studio: ${studio.name}`)
  }

  async function handleAddStudio() {
    const created = await addHomepageStudio()
    setHomepageModel((prev) => (prev ? { ...prev, studios: [...prev.studios, created] } : prev))
    setMessage(`Added studio: ${created.name}`)
  }

  function buildHeroSlides(model: HomepageContentModel) {
    return [
      {
        enabled: model.raffleTile.active,
        tag: model.raffleTile.badge,
        title: model.raffleTile.title,
        subtitle: model.raffleTile.subtitle,
        cta_label: model.raffleTile.ctaLabel,
        cta_link: model.raffleTile.ctaLink,
        image_url: normalizeCmsAssetRef(model.raffleTile.image),
        interactive: 'raffle_tickets',
      },
      ...model.promoTiles.map((tile) => ({
        enabled: tile.active,
        tag: tile.badge,
        title: tile.title,
        subtitle: tile.subtitle,
        cta_label: tile.ctaLabel,
        cta_link: tile.ctaLink,
        image_url: normalizeCmsAssetRef(tile.image),
        interactive: null,
      })),
    ]
  }

  async function saveAuthVisualCard() {
    const normalizedImage = normalizeCmsAssetRef(authDesktopVisualImage)
    const response = await apiFetch('/v1/admin/content/auth_desktop_visual_image', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: normalizedImage }),
    })
    if (!response.ok) {
      setMessage(`Could not save auth visual (HTTP ${response.status})`)
      return
    }
    const verify = await apiFetch('/v1/admin/content/auth_desktop_visual_image')
    if (verify.ok) {
      const payload = (await verify.json()) as { content?: string }
      setMessage(`Auth visual saved: ${String(payload.content ?? normalizedImage)}`)
    } else {
      setMessage('Auth visual saved and pushed to player UI')
    }
    setAuthDesktopVisualImage(normalizedImage)
  }

  async function saveRaffleCard() {
    if (!homepageModel) return
    const response = await apiFetch('/v1/admin/content/hero_slides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: buildHeroSlides(homepageModel) }),
    })
    if (!response.ok) {
      setMessage(`Could not save raffle card (HTTP ${response.status})`)
      return
    }
    const verify = await apiFetch('/v1/admin/content/hero_slides')
    if (verify.ok) {
      const payload = (await verify.json()) as { content?: Array<{ image_url?: string }> }
      const firstImage = payload.content?.[0]?.image_url ?? 'n/a'
      setMessage(`Raffle tile saved. hero_slides[0].image_url=${firstImage}`)
    } else {
      setMessage('Raffle card saved and pushed to player UI')
    }
  }

  async function savePromoCards() {
    if (!homepageModel) return
    const normalizedMs = Math.max(1500, Math.min(30000, Math.round(Number(promoAutoplayMs) || 5000)))
    setPromoAutoplayMs(normalizedMs)
    const [slidesResponse, settingsResponse] = await Promise.all([
      apiFetch('/v1/admin/content/hero_slides', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: buildHeroSlides(homepageModel) }),
      }),
      apiFetch('/v1/admin/content/hero_slides_settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {
            autoplay_enabled: promoAutoplayEnabled,
            autoplay_ms: normalizedMs,
          },
        }),
      }),
    ])
    if (!slidesResponse.ok || !settingsResponse.ok) {
      setMessage(`Could not save promo cards (hero=${slidesResponse.status}, settings=${settingsResponse.status})`)
      return
    }
    const verify = await apiFetch('/v1/admin/content/hero_slides')
    if (verify.ok) {
      const payload = (await verify.json()) as { content?: Array<{ image_url?: string }> }
      const firstPromoImage = payload.content?.[1]?.image_url ?? 'n/a'
      setMessage(`Promo tiles saved. hero_slides[1].image_url=${firstPromoImage}`)
    } else {
      setMessage('Promo cards saved and pushed to player UI')
    }
  }

  async function saveStudiosCard() {
    if (!homepageModel) return
    const payload = homepageModel.studios.map((studio) => ({
      id: studio.id,
      label: studio.name,
      providerQuery: studio.name.toLowerCase().replace(/\s+/g, ''),
      src: normalizeCmsAssetRef(studio.logo),
      active: studio.active,
      sortOrder: studio.sortOrder,
    }))
    const response = await apiFetch('/v1/admin/content/home_studios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: payload }),
    })
    if (!response.ok) {
      setMessage(`Could not save studios card (HTTP ${response.status})`)
      return
    }
    const verify = await apiFetch('/v1/admin/content/home_studios')
    if (verify.ok) {
      const payload = (await verify.json()) as { content?: Array<{ src?: string }> }
      const firstStudio = payload.content?.[0]?.src ?? 'n/a'
      setMessage(`Studios saved. home_studios[0].src=${firstStudio}`)
    } else {
      setMessage('Studios card saved and pushed to player UI')
    }
  }

  async function handleUploadAsset(file: File): Promise<string | null> {
    const data = new FormData()
    data.append('file', file)
    const response = await apiFetch('/v1/admin/content/upload', {
      method: 'POST',
      body: data,
    })

    if (!response.ok) {
      setMessage(`Upload failed (HTTP ${response.status})`)
      return null
    }
    const payload = (await response.json()) as { url?: string }
    if (!payload.url) {
      setMessage('Upload failed (missing URL)')
      return null
    }
    setMessage('Image uploaded successfully')
    return payload.url
  }

  async function handleRunContentHealthCheck() {
    setContentHealthLoading(true)
    try {
      const response = await apiFetch('/v1/admin/ops/content-health')
      if (!response.ok) {
        setMessage(`Content health check failed (HTTP ${response.status})`)
        return
      }
      const payload = (await response.json()) as { ok?: boolean; summary?: ContentHealthSummary }
      setContentHealth(payload.summary ?? null)
      setContentHealthOk(Boolean(payload.ok))
      setMessage(payload.ok ? 'Content durability check passed' : 'Content durability check found issues')
    } finally {
      setContentHealthLoading(false)
    }
  }

  return (
    <>
      <PageMeta title="Content CMS" description="Manage existing website content without creating new public pages." />
      <PageBreadcrumb
        pageTitle="Content Management System"
        subtitle="Edit existing page content, legal copy, homepage sections and reusable site text (VIP excluded)."
      />

      {message ? (
        <div className="alert alert-success py-2" role="status">
          {message}
        </div>
      ) : null}

      <ComponentCard title="CMS Navigation" desc="Manage existing website content only. New public pages are intentionally disabled.">
        <div className="d-flex flex-wrap gap-2">
          {(
            [
              ['pages', 'Existing Page Content Manager'],
              ['editor', 'Section Based Content Editor'],
              ['policies', 'Policy and Legal Content Manager'],
              ['homepage', 'Homepage Content Manager'],
              ['durability', 'Durability and Asset Health'],
              ['banners', 'Banner and Promo Content Manager'],
              ['faq', 'FAQ Content Manager'],
              ['footer-nav', 'Footer and Navigation Content Manager'],
              ['media', 'Media Content Support'],
              ['activity', 'CMS Activity Log'],
            ] as Array<[CmsTab, string]>
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
      </ComponentCard>

      {loading ? <p className="text-body-secondary">Loading CMS content model…</p> : null}

      {!loading && activeTab === 'pages' ? (
        <ComponentCard title="Existing Page Content Manager" desc="Only existing routes are editable. VIP content is excluded.">
          <div className="row g-2 align-items-end mb-3">
            <div className="col-12 col-md-4">
              <label className="form-label small">Search pages</label>
              <input
                type="text"
                className="form-control form-control-sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by route or name"
              />
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle">
              <thead>
                <tr>
                  <th>Page name</th>
                  <th>Route</th>
                  <th>Content type</th>
                  <th>Editable sections</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((page) => (
                  <tr key={page.id}>
                    <td>{page.name}</td>
                    <td><code>{page.route}</code></td>
                    <td className="text-capitalize">{page.contentType}</td>
                    <td>{page.sections.length}</td>
                    <td><span className={`badge ${statusBadgeClass(page.status)}`}>{page.status}</span></td>
                    <td>{new Date(page.lastUpdated).toLocaleString()}</td>
                    <td className="d-flex gap-1">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => {
                          setSelectedRoute(page.route)
                          setActiveTab('editor')
                        }}
                      >
                        Edit Content
                      </button>
                      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setSelectedRoute(page.route)}>
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}

      {!loading && activeTab === 'editor' ? (
        <div className="row g-3">
          <div className="col-12 col-lg-3">
            <ComponentCard title="Section list sidebar">
              <div className="list-group">
                {(pageDraft?.sections ?? []).map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`list-group-item list-group-item-action ${selectedSectionId === section.id ? 'active' : ''}`}
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    <div className="fw-semibold">{section.title}</div>
                    <small>{section.description}</small>
                  </button>
                ))}
              </div>
            </ComponentCard>
          </div>
          <div className="col-12 col-lg-5">
            <ComponentCard
              title="Content fields"
              desc={pageDraft ? `${pageDraft.name} (${pageDraft.route})` : 'Select a page'}
              headerActions={
                <>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void handleSaveDraft()}>
                    Save draft
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handlePublishPage()}>
                    Publish changes
                  </button>
                  <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => void handleRevertPage()}>
                    Revert changes
                  </button>
                </>
              }
            >
              {selectedSection ? (
                <div className="d-flex flex-column gap-3">
                  {selectedSection.fields.map((field) => (
                    <div key={field.id}>
                      <label className="form-label small">{field.label}</label>
                      {field.type === 'toggle' ? (
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={Boolean(field.value)}
                            onChange={(event) => void handleUpdateField(field, event.target.checked)}
                          />
                        </div>
                      ) : field.type === 'textarea' || field.type === 'richtext' || field.type === 'seo' ? (
                        <textarea
                          className="form-control form-control-sm"
                          rows={field.type === 'richtext' ? 6 : 3}
                          value={fieldValueAsString(field.value)}
                          onChange={(event) => void handleUpdateField(field, event.target.value)}
                        />
                      ) : field.type === 'image' ? (
                        <div className="d-flex flex-column gap-2">
                          <input
                            className="form-control form-control-sm"
                            value={fieldValueAsString(field.value)}
                            onChange={(event) => void handleUpdateField(field, event.target.value)}
                          />
                          <img
                            src={fieldValueAsString(field.value)}
                            alt={field.label}
                            className="rounded border"
                            style={{ maxHeight: 140, objectFit: 'cover' }}
                          />
                        </div>
                      ) : (
                        <input
                          className="form-control form-control-sm"
                          value={fieldValueAsString(field.value)}
                          onChange={(event) => void handleUpdateField(field, event.target.value)}
                        />
                      )}
                    </div>
                  ))}
                  <p className="text-body-secondary small mb-0">
                    Last edited: {new Date(selectedSection.lastEditedAt).toLocaleString()} by {selectedSection.lastEditedBy}
                  </p>
                </div>
              ) : (
                <p className="text-body-secondary mb-0">Choose a section from the sidebar.</p>
              )}
            </ComponentCard>
          </div>
          <div className="col-12 col-lg-4">
            <ComponentCard title="Preview panel">
              {selectedSection ? (
                <div className="d-flex flex-column gap-2">
                  <h6>{selectedSection.title}</h6>
                  {selectedSection.fields.map((field) => (
                    <div key={field.id}>
                      <small className="text-body-secondary text-uppercase">{field.label}</small>
                      <div className="border rounded p-2 bg-body-tertiary">
                        {field.type === 'image' ? (
                          <img
                            src={fieldValueAsString(field.value)}
                            alt={field.label}
                            className="w-100 rounded"
                            style={{ maxHeight: 140, objectFit: 'cover' }}
                          />
                        ) : (
                          <span>{fieldValueAsString(field.value)}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-body-secondary mb-0">Preview appears after selecting a section.</p>
              )}
            </ComponentCard>
          </div>
        </div>
      ) : null}

      {!loading && activeTab === 'policies' ? (
        <div className="row g-3">
          <div className="col-12 col-lg-4">
            <ComponentCard title="Policy pages">
              <div className="list-group">
                {policies.map((policy) => (
                  <button
                    key={policy.id}
                    type="button"
                    className={`list-group-item list-group-item-action ${policyId === policy.id ? 'active' : ''}`}
                    onClick={() => setPolicyId(policy.id)}
                  >
                    <div className="d-flex justify-content-between">
                      <span>{policy.title}</span>
                      <span className={`badge ${statusBadgeClass(policy.status)}`}>{policy.status}</span>
                    </div>
                    <small>{policy.route}</small>
                  </button>
                ))}
              </div>
            </ComponentCard>
          </div>
          <div className="col-12 col-lg-8">
            <ComponentCard
              title="Policy and Legal Content Manager"
              desc="Terms, privacy, AML, KYC, responsible gaming, cookie policy and other existing legal pages."
              headerActions={
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handlePolicyPublish()}>
                  Publish version
                </button>
              }
            >
              {policyDraft ? (
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label small">Policy title</label>
                    <input
                      className="form-control form-control-sm"
                      value={policyDraft.title}
                      onChange={(event) => void handlePolicyFieldChange('title', event.target.value)}
                    />
                  </div>
                  <div className="col-12 col-md-3">
                    <label className="form-label small">Effective date</label>
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      value={policyDraft.effectiveDate}
                      onChange={(event) => void handlePolicyFieldChange('effectiveDate', event.target.value)}
                    />
                  </div>
                  <div className="col-12 col-md-3">
                    <label className="form-label small">Version number</label>
                    <input
                      className="form-control form-control-sm"
                      value={policyDraft.version}
                      onChange={(event) => void handlePolicyFieldChange('version', event.target.value)}
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label small">Jurisdiction</label>
                    <input
                      className="form-control form-control-sm"
                      value={policyDraft.jurisdiction}
                      onChange={(event) => void handlePolicyFieldChange('jurisdiction', event.target.value)}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label small">Rich text content</label>
                    <textarea
                      className="form-control form-control-sm"
                      rows={10}
                      value={policyDraft.body}
                      onChange={(event) => void handlePolicyFieldChange('body', event.target.value)}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label small">Change summary</label>
                    <textarea
                      className="form-control form-control-sm"
                      rows={2}
                      value={policyDraft.changeSummary}
                      onChange={(event) => void handlePolicyFieldChange('changeSummary', event.target.value)}
                    />
                  </div>
                  <div className="col-12">
                    <h6>Version history</h6>
                    <div className="table-responsive">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Effective date</th>
                            <th>Published by</th>
                            <th>Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {policyDraft.history.map((entry) => (
                            <tr key={`${entry.version}-${entry.publishedAt}`}>
                              <td>{entry.version}</td>
                              <td>{entry.effectiveDate}</td>
                              <td>{entry.publishedBy}</td>
                              <td>{entry.changeSummary}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-body-secondary mb-0">Select a policy page to edit.</p>
              )}
            </ComponentCard>
          </div>
        </div>
      ) : null}

      {!loading && activeTab === 'homepage' ? (
        <div className="d-flex flex-column gap-3">
          <ComponentCard
            title="Auth Modal Desktop Background"
            desc="Controls the desktop/tablet right-panel image on sign-in/sign-up."
            headerActions={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveAuthVisualCard()}>
                Save Auth Visual
              </button>
            }
          >
            <div className="row g-2">
              <div className="col-12">
                <label className="form-label small">Image upload and preview</label>
                <ImageUploadField
                  id="auth-desktop-visual-image"
                  value={authDesktopVisualImage}
                  onChange={(next) => {
                    setAuthDesktopVisualImage(next)
                    setMessage('Updated auth desktop visual image')
                  }}
                  onUploadFile={handleUploadAsset}
                />
                <p className="small text-body-secondary mb-0 mt-1">
                  Saved to content key <code>auth_desktop_visual_image</code> when you click Save Homepage Updates.
                </p>
              </div>
            </div>
          </ComponentCard>

          <ComponentCard
            title="Raffle / Lottery Hero Tile"
            desc="Dedicated editor for the raffle tile content and image."
            headerActions={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRaffleCard()}>
                Save Raffle Tile
              </button>
            }
          >
            {homepageModel ? (
              <div className="row g-2">
                {(
                  [
                    ['badge', 'Badge'],
                    ['title', 'Title'],
                    ['subtitle', 'Subtitle'],
                    ['ctaLabel', 'CTA label'],
                    ['ctaLink', 'CTA link'],
                    ['ticketsLabel', 'Tickets label'],
                    ['countdownText', 'Countdown text'],
                  ] as Array<[keyof HomeRaffleTile, string]>
                ).map(([field, label]) => (
                  <div className="col-12 col-md-6" key={field}>
                    <label className="form-label small">{label}</label>
                    <input
                      className="form-control form-control-sm"
                      placeholder={field === 'ctaLink' ? '/bonuses or https://example.com/page' : undefined}
                      value={fieldValueAsString(homepageModel.raffleTile[field])}
                      onChange={(event) => void handleUpdateRaffleField(field, event.target.value)}
                    />
                    {field === 'ctaLink' ? (
                      <p className="small text-body-secondary mb-0 mt-1">
                        Supports internal links (e.g. <code>/bonuses</code>) and full URLs.
                      </p>
                    ) : null}
                  </div>
                ))}
                <div className="col-12">
                  <label className="form-label small">Image upload and preview</label>
                  <ImageUploadField
                    id="raffle-tile-image"
                    value={homepageModel.raffleTile.image}
                    onChange={(next) => handleUpdateRaffleField('image', next)}
                    onUploadFile={handleUploadAsset}
                  />
                </div>
              </div>
            ) : (
              <p className="text-body-secondary mb-0">Raffle tile model unavailable.</p>
            )}
          </ComponentCard>

          <ComponentCard
            title="Rotating Promo Hero Tiles"
            desc="Edit text, links and images for permanent and additional rotating tiles."
            headerActions={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void savePromoCards()}>
                Save Promo Tiles
              </button>
            }
          >
            {homepageModel ? (
              <div className="col-12">
                <div className="d-flex align-items-center justify-content-between">
                  <h6 className="mb-0">Hero tiles</h6>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleAddPromoTile()}>
                    Add tile
                  </button>
                </div>
                <div className="row g-2 mt-1 mb-2">
                  <div className="col-12 col-md-4">
                    <label className="form-label small mb-1">Auto-rotate interval (ms)</label>
                    <input
                      type="number"
                      min={1500}
                      max={30000}
                      step={100}
                      className="form-control form-control-sm"
                      value={promoAutoplayMs}
                      onChange={(event) => setPromoAutoplayMs(Number(event.target.value || 5000))}
                    />
                    <small className="text-body-secondary">1500 to 30000 ms</small>
                  </div>
                  <div className="col-12 col-md-4 d-flex align-items-end">
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={promoAutoplayEnabled}
                        onChange={(event) => setPromoAutoplayEnabled(event.target.checked)}
                        id="promo-autoplay-enabled"
                      />
                      <label className="form-check-label small" htmlFor="promo-autoplay-enabled">
                        Enable auto-rotate
                      </label>
                    </div>
                  </div>
                </div>
                <p className="small text-body-secondary mt-1 mb-2">
                  You can add more tiles and keep them active for rotation/switching.
                </p>
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Badge</th>
                        <th>Title</th>
                        <th>Subtitle</th>
                        <th>CTA label</th>
                        <th>CTA link</th>
                        <th>Image upload and preview</th>
                        <th>Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {homepageModel.promoTiles.map((tile) => (
                        <tr key={tile.id}>
                          <td>
                            <input className="form-control form-control-sm" value={tile.badge} onChange={(event) => void handleUpdatePromoTile(tile, 'badge', event.target.value)} />
                          </td>
                          <td>
                            <input className="form-control form-control-sm" value={tile.title} onChange={(event) => void handleUpdatePromoTile(tile, 'title', event.target.value)} />
                          </td>
                          <td>
                            <input className="form-control form-control-sm" value={tile.subtitle} onChange={(event) => void handleUpdatePromoTile(tile, 'subtitle', event.target.value)} />
                          </td>
                          <td>
                            <input className="form-control form-control-sm" value={tile.ctaLabel} onChange={(event) => void handleUpdatePromoTile(tile, 'ctaLabel', event.target.value)} />
                          </td>
                          <td>
                            <input
                              className="form-control form-control-sm"
                              placeholder="/casino/games or https://example.com/page"
                              value={tile.ctaLink}
                              onChange={(event) => void handleUpdatePromoTile(tile, 'ctaLink', event.target.value)}
                            />
                            <small className="text-body-secondary d-block mt-1">
                              Internal and full URL supported
                            </small>
                          </td>
                          <td style={{ minWidth: 260 }}>
                            <ImageUploadField
                              id={`promo-tile-image-${tile.id}`}
                              value={tile.image}
                              onChange={(next) => handleUpdatePromoTile(tile, 'image', next)}
                              onUploadFile={handleUploadAsset}
                            />
                          </td>
                          <td>
                            <div className="form-check form-switch">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={tile.active}
                                onChange={(event) => void handleUpdatePromoTile(tile, 'active', event.target.checked)}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-body-secondary mb-0">Homepage hero tiles model unavailable.</p>
            )}
          </ComponentCard>

          <ComponentCard
            title="Homepage Studios Section"
            desc="Edit current studios logos and add more items for the scrolling strip."
            headerActions={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveStudiosCard()}>
                Save Studios
              </button>
            }
          >
            {homepageModel ? (
              <>
                <div className="d-flex justify-content-end mb-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleAddStudio()}>
                    Add studio
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Studio name</th>
                        <th>Logo upload and preview</th>
                        <th>Sort order</th>
                        <th>Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {homepageModel.studios
                        .slice()
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((studio) => (
                          <tr key={studio.id}>
                            <td>
                              <input className="form-control form-control-sm" value={studio.name} onChange={(event) => void handleUpdateStudio(studio, 'name', event.target.value)} />
                            </td>
                            <td style={{ minWidth: 260 }}>
                              <ImageUploadField
                                id={`studio-logo-${studio.id}`}
                                value={studio.logo}
                                onChange={(next) => handleUpdateStudio(studio, 'logo', next)}
                                onUploadFile={handleUploadAsset}
                              />
                            </td>
                            <td style={{ width: 110 }}>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={studio.sortOrder}
                                onChange={(event) => void handleUpdateStudio(studio, 'sortOrder', Number(event.target.value || 0))}
                              />
                            </td>
                            <td style={{ width: 100 }}>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={studio.active}
                                  onChange={(event) => void handleUpdateStudio(studio, 'active', event.target.checked)}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-body-secondary mb-0">Studios model unavailable.</p>
            )}
          </ComponentCard>
        </div>
      ) : null}

      {!loading && activeTab === 'durability' ? (
        <div className="d-flex flex-column gap-3">
          <ComponentCard
            title="Data Durability and Asset Health"
            desc="Verify that CMS content/media references are durable across deploys/restarts."
            headerActions={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleRunContentHealthCheck()}
                disabled={contentHealthLoading}
              >
                {contentHealthLoading ? 'Running check…' : 'Run check'}
              </button>
            }
          >
            <p className="small text-body-secondary mb-0">
              This checks missing critical content keys, broken upload references, and accidental blob URLs.
            </p>
          </ComponentCard>

          {contentHealth ? (
            <ComponentCard
              title="Health Summary"
              desc={contentHealthOk ? 'No durability issues detected.' : 'Durability issues detected.'}
            >
              <div className="row g-2 mb-2">
                <div className="col-12 col-md-4"><strong>Content keys:</strong> {contentHealth.content_keys}</div>
                <div className="col-12 col-md-4"><strong>Stored upload assets:</strong> {contentHealth.upload_assets_stored}</div>
                <div className="col-12 col-md-4"><strong>Upload refs checked:</strong> {contentHealth.upload_refs_checked}</div>
                <div className="col-12 col-md-4"><strong>Broken upload refs:</strong> {contentHealth.broken_upload_refs}</div>
                <div className="col-12 col-md-4"><strong>Blob refs:</strong> {contentHealth.blob_refs_detected}</div>
                <div className="col-12 col-md-4">
                  <strong>Status:</strong>{' '}
                  <span className={`badge ${contentHealthOk ? 'text-bg-success' : 'text-bg-danger'}`}>
                    {contentHealthOk ? 'Healthy' : 'Needs attention'}
                  </span>
                </div>
              </div>

              {contentHealth.missing_critical_keys.length > 0 ? (
                <div className="alert alert-warning py-2">
                  Missing critical keys: {contentHealth.missing_critical_keys.join(', ')}
                </div>
              ) : null}

              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Issue</th>
                      <th>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contentHealth.issues.length > 0 ? (
                      contentHealth.issues.map((issue, index) => (
                        <tr key={`${issue.key}-${issue.reason}-${index}`}>
                          <td><code>{issue.key}</code></td>
                          <td>{issue.reason}</td>
                          <td className="text-truncate" style={{ maxWidth: 320 }}>{issue.preview ?? '—'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="text-body-secondary">No issues found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </ComponentCard>
          ) : null}
        </div>
      ) : null}

      {!loading && activeTab === 'banners' ? (
        <ComponentCard title="Banner and Promo Content Manager" desc="Manage existing promotional content placements and schedules.">
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Banner</th>
                  <th>Placement</th>
                  <th>Status</th>
                  <th>CTA</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {banners.map((banner) => (
                  <tr key={banner.id}>
                    <td className="w-50">
                      <div className="d-flex flex-column gap-1">
                        <strong>{banner.label}</strong>
                        <input
                          className="form-control form-control-sm"
                          value={banner.text}
                          onChange={(event) => void handleBannerUpdate(banner, 'text', event.target.value)}
                        />
                        <input
                          className="form-control form-control-sm"
                          value={banner.image}
                          onChange={(event) => void handleBannerUpdate(banner, 'image', event.target.value)}
                        />
                        <img src={banner.image} alt={banner.label} className="rounded border" style={{ maxHeight: 90, maxWidth: 220, objectFit: 'cover' }} />
                      </div>
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={banner.placement}
                        onChange={(event) => void handleBannerUpdate(banner, 'placement', event.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={banner.status}
                        onChange={(event) => void handleBannerUpdate(banner, 'status', event.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="scheduled">scheduled</option>
                        <option value="paused">paused</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm mb-1"
                        value={banner.ctaLabel}
                        onChange={(event) => void handleBannerUpdate(banner, 'ctaLabel', event.target.value)}
                      />
                      <input
                        className="form-control form-control-sm"
                        value={banner.ctaLink}
                        onChange={(event) => void handleBannerUpdate(banner, 'ctaLink', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={banner.startDate}
                        onChange={(event) => void handleBannerUpdate(banner, 'startDate', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={banner.endDate}
                        onChange={(event) => void handleBannerUpdate(banner, 'endDate', event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}

      {!loading && activeTab === 'faq' ? (
        <ComponentCard title="FAQ Content Manager" desc="Edit existing FAQ entries by category, answer, order and visibility.">
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Question</th>
                  <th>Answer</th>
                  <th>Sort</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {faqItems.map((faq) => (
                  <tr key={faq.id}>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={faq.category}
                        onChange={(event) => void handleFaqUpdate(faq, 'category', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={faq.question}
                        onChange={(event) => void handleFaqUpdate(faq, 'question', event.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        className="form-control form-control-sm"
                        rows={2}
                        value={faq.answer}
                        onChange={(event) => void handleFaqUpdate(faq, 'answer', event.target.value)}
                      />
                    </td>
                    <td style={{ width: 90 }}>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={faq.sortOrder}
                        onChange={(event) => void handleFaqUpdate(faq, 'sortOrder', Number(event.target.value || 0))}
                      />
                    </td>
                    <td style={{ width: 90 }}>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={faq.active}
                          onChange={(event) => void handleFaqUpdate(faq, 'active', event.target.checked)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}

      {!loading && activeTab === 'footer-nav' ? (
        <ComponentCard title="Footer and Navigation Content Manager" desc="Manage existing footer, legal, support, social and header labels only.">
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Label</th>
                  <th>Path or URL</th>
                </tr>
              </thead>
              <tbody>
                {links.map((link) => (
                  <tr key={link.id}>
                    <td className="text-capitalize">{link.group}</td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={link.label}
                        onChange={(event) => void handleLinkUpdate(link, 'label', event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control form-control-sm"
                        value={link.href}
                        onChange={(event) => void handleLinkUpdate(link, 'href', event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}

      {!loading && activeTab === 'media' ? (
        <ComponentCard title="Media Content Support" desc="Use existing asset paths or prepare uploads for future backend integration.">
          <div className="row g-3">
            <div className="col-12 col-lg-6">
              <label className="form-label small">Existing image path</label>
              <input className="form-control form-control-sm" value={mediaPath} onChange={(event) => setMediaPath(event.target.value)} />
              <div className="d-flex gap-2 mt-2">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => navigator.clipboard.writeText(mediaPath)}>
                  Copy asset path
                </button>
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setMediaPath('/assets/hero/main-banner.png')}>
                  Replace image path
                </button>
              </div>
              <p className="small text-body-secondary mt-2 mb-0">
                Upload handling is placeholder-only until backend media APIs are connected.
              </p>
            </div>
            <div className="col-12 col-lg-6">
              <label className="form-label small">Preview</label>
              <div className="border rounded p-2 bg-body-tertiary">
                <img
                  src={mediaPath}
                  alt="Media preview"
                  className="w-100 rounded"
                  style={{ maxHeight: 260, objectFit: 'cover' }}
                />
              </div>
            </div>
          </div>
        </ComponentCard>
      ) : null}

      {!loading && activeTab === 'activity' ? (
        <ComponentCard title="CMS Activity Log" desc="Tracks content edits and publish state changes.">
          <div className="table-responsive">
            <table className="table table-sm table-striped align-middle">
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Page or section</th>
                  <th>Action type</th>
                  <th>Previous value summary</th>
                  <th>New value summary</th>
                  <th>Publish status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.admin}</td>
                    <td>{entry.target}</td>
                    <td>{entry.actionType}</td>
                    <td>{entry.previousValueSummary}</td>
                    <td>{entry.newValueSummary}</td>
                    <td>
                      <span className={`badge ${statusBadgeClass(entry.publishStatus)}`}>{entry.publishStatus}</span>
                    </td>
                    <td>{new Date(entry.date).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ComponentCard>
      ) : null}
    </>
  )
}
