import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { FingerprintProvider } from '@fingerprint/react'
import './index.css'
import App from './App.tsx'
import { FingerprintIntegrationBoundary } from './lib/fingerprintIntegrationBoundary'
import { FingerprintProviderFallbackBoundary } from './lib/fingerprintProviderFallbackBoundary'
import { FingerprintReactIntegration } from './lib/fingerprintReactIntegration'

function fingerprintLoaderOptions(): { apiKey: string; region?: 'us' | 'eu' | 'ap' } | null {
  const raw = import.meta.env.VITE_FINGERPRINT_PUBLIC_KEY
  if (typeof raw !== 'string' || !raw.trim()) return null
  const r = import.meta.env.VITE_FINGERPRINT_REGION?.trim().toLowerCase()
  const region = r === 'eu' || r === 'us' || r === 'ap' ? r : undefined
  return { apiKey: raw.trim(), region }
}

const fpOpts = fingerprintLoaderOptions()

if (fpOpts && fpOpts.region === undefined) {
  console.warn(
    '[fingerprint] VITE_FINGERPRINT_REGION is not set. EU workspaces must use VITE_FINGERPRINT_REGION=eu (redeploy on Vercel) or events hit the wrong region and "Check installation" shows Event not found.',
  )
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
