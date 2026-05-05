import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import { FingerprintProvider } from '@fingerprint/react'
import './index.css'
import App from './App.tsx'
import { FingerprintIntegrationBoundary } from './lib/fingerprintIntegrationBoundary'
import { FingerprintProviderFallbackBoundary } from './lib/fingerprintProviderFallbackBoundary'
import { FingerprintReactIntegration } from './lib/fingerprintReactIntegration'

function fingerprintLoaderOptions(): { apiKey: string; region: 'us' | 'eu' | 'ap' } | null {
  const raw = import.meta.env.VITE_FINGERPRINT_PUBLIC_KEY
  if (typeof raw !== 'string' || !raw.trim()) return null
  const r = import.meta.env.VITE_FINGERPRINT_REGION?.trim().toLowerCase()
  const region: 'us' | 'eu' | 'ap' = r === 'eu' || r === 'us' || r === 'ap' ? r : 'us'
  return { apiKey: raw.trim(), region }
}

const fpOpts = fingerprintLoaderOptions()

if (import.meta.env.DEV && fpOpts) {
  const br = import.meta.env.VITE_FINGERPRINT_REGION
  if (typeof br !== 'string' || !br.trim()) {
    console.info(
      '[fingerprint] VITE_FINGERPRINT_REGION not set; agent defaults to us. EU workspace: set VITE_FINGERPRINT_REGION=eu and API FINGERPRINT_API_BASE_URL=https://eu.api.fpjs.io',
    )
  }
}

const appTree = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {fpOpts ? (
      <FingerprintProviderFallbackBoundary fallback={appTree}>
        <FingerprintProvider apiKey={fpOpts.apiKey} region={fpOpts.region}>
          <FingerprintIntegrationBoundary>
            <FingerprintReactIntegration />
          </FingerprintIntegrationBoundary>
          {appTree}
        </FingerprintProvider>
      </FingerprintProviderFallbackBoundary>
    ) : (
      appTree
    )}
  </StrictMode>,
)
