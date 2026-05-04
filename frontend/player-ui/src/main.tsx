import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { FingerprintProvider } from '@fingerprint/react'
import './index.css'
import App from './App.tsx'
import { FingerprintReactIntegration } from './lib/fingerprintReactIntegration'

function fingerprintLoaderOptions(): { apiKey: string; region?: 'us' | 'eu' | 'ap' } | null {
  const raw = import.meta.env.VITE_FINGERPRINT_PUBLIC_KEY
  if (typeof raw !== 'string' || !raw.trim()) return null
  const r = import.meta.env.VITE_FINGERPRINT_REGION?.trim().toLowerCase()
  const region = r === 'eu' || r === 'us' || r === 'ap' ? r : undefined
  return { apiKey: raw.trim(), region }
}

const fpOpts = fingerprintLoaderOptions()

const appTree = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {fpOpts ? (
      <FingerprintProvider apiKey={fpOpts.apiKey} region={fpOpts.region}>
        <FingerprintReactIntegration />
        {appTree}
      </FingerprintProvider>
    ) : (
      appTree
    )}
  </StrictMode>,
)
