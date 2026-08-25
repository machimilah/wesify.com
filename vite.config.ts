import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.BO_API_PORT || '8787'

/**
 * The suites must not load the real Clerk instance, and blanking the variable is not enough.
 *
 * Vite reads `.env.local` from disk itself, whatever the process environment says — that is the
 * whole point of the file. So `noInfra.mjs` emptying `VITE_CLERK_PUBLISHABLE_KEY` had no effect
 * here: the browser under test still got the developer's key, mounted Clerk, was told by it that
 * nobody was signed in, and threw away the session the suite had just handed it. Every browser
 * suite that needed a signed-in page failed, and the failure looked like the app's.
 *
 * `define` wins over the file, so this is the one place that can say no. It is deliberately a
 * separate flag rather than reading the key: "the suite is running" is the fact being expressed, and
 * a blank key is only what follows from it.
 */
const clerkDisabled = Boolean(process.env.BO_DISABLE_CLERK)

export default defineConfig({
  plugins: [react()],
  ...(clerkDisabled ? { define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': '""' } } : {}),
  server: { port: 4173, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  preview: { port: 4173 },
})
