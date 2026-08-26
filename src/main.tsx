import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import App from './App'
import { applyStoredTheme } from './engine/theme'
import './theme.css'
import './styles.css'
import './schema.css'
import '@xyflow/react/dist/style.css'
import './workflow.css'

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
      ? <ClerkProvider
          publishableKey={publishableKey}
          /**
           * Where Clerk sends somebody afterwards, which has to be said or it guesses.
           *
           * Unset, Clerk's default is its own hosted Account Portal — a page on accounts.dev that
           * says "you're not signed in yet, sign in to connect Clerk to your application". Somebody
           * who has just proved who they are ends up on a stranger's domain reading about Clerk
           * instead of in the workspace they came for.
           *
           * "/" for all three, because Wesify decides the rest itself: App.tsx sends a returning
           * operator to the workspace they last used and a new one to the build prompt, and it is
           * the only thing that knows which of those applies.
           */
          signInForceRedirectUrl="/"
          signUpForceRedirectUrl="/"
          afterSignOutUrl="/"
          /**
           * Clerk navigates through Wesify's history rather than the address bar.
           *
           * Left alone, finishing a sign-in is a full page load: the whole bundle is parsed again,
           * the app boots from nothing, and the person who just typed a password watches a white
           * screen for it. Wesify is a single page that routes by reading `window.location`, so the
           * cheapest possible answer is to push the URL and tell the app to look at it.
           *
           * A `popstate` event is that telling. App.tsx already listens for one — it is how the back
           * button works — so this needs no second route table and cannot fall out of step with the
           * one that exists.
           */
          routerPush={to => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }}
          routerReplace={to => { window.history.replaceState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')) }}
        ><App /></ClerkProvider>
      : <App />}
  </React.StrictMode>,
)
