import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App'
import { applyStoredTheme } from './engine/theme'
import './theme.css'
import './styles.css'
import './schema.css'

// Before anything renders: a theme applied after first paint is a theme that flashes.
applyStoredTheme()

/**
 * Clerk wraps the app only when this build was given a key.
 *
 * Wesify still runs with no accounts at all — no database, no Clerk, one browser — and that mode must
 * not depend on a provider that would refuse to mount without a key. So the tree is wrapped when
 * there is one and left alone when there is not; `accountsEnabled()` is what the interface actually
 * follows, and it asks the server rather than reading this.
 *
 * The publishable key is public by design. It names the Clerk instance and authorises nothing on its
 * own — the secret key that verifies tokens is the server's, and is never in this bundle.
 */
const publishableKey = String(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publishableKey
      ? <ClerkProvider publishableKey={publishableKey}><App /></ClerkProvider>
      : <App />}
  </React.StrictMode>,
)
