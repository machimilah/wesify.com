/**
 * Where Wesify's API lives, which is not always where the interface lives.
 *
 * On a laptop and in the container these are one origin: the same Node process serves `dist` and
 * `/api`, so a relative path is exactly right and this returns an empty string.
 *
 * They come apart on a static host. Vercel builds the frontend and serves `dist` — it never runs
 * `server/index.mjs`, so every relative `/api/...` call lands on the CDN, which answers with the
 * index page or a 404. The symptom is that nothing needing a key works and the deployment looks like
 * it is ignoring its environment variables, when in truth no process ever read them: the keys are
 * the server's, and the server is somewhere else.
 *
 * `VITE_API_URL` names that somewhere. Vite inlines it at build time — it is the only kind of
 * variable a browser bundle can be given — so it must be set on the frontend deployment, not on the
 * API host. Unset, everything behaves exactly as it did before.
 *
 * It is deliberately not a secret. Anything in `import.meta.env` is compiled into JavaScript that
 * anyone can read, which is why Wesify's model keys are read only by the server and never named here.
 */
const configured = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')

export const apiOrigin = configured

/**
 * `apiUrl('/api/health')` — the one place a path becomes a URL.
 *
 * Every client module goes through this rather than fetching a bare path, so pointing Wesify at a
 * separate API host is one environment variable instead of nineteen call sites, and a new call site
 * cannot quietly hard-code the assumption that the two are the same origin. `structure.test.mjs`
 * fails the build if one does.
 */
export function apiUrl(path: string) {
  return configured ? `${configured}${path.startsWith('/') ? path : `/${path}`}` : path
}

/**
 * Cross-origin requests carry no cookies unless asked to, and Wesify's do have to.
 *
 * Wesify authenticates with a bearer token in a header rather than a cookie, so this changes nothing
 * today — but a same-origin deployment sends credentials by default and a cross-origin one does not,
 * and that difference is exactly the kind of thing that works locally and fails only in production.
 * Stating it once here means both deployments behave the same way.
 */
export const apiCredentials: RequestCredentials = configured ? 'include' : 'same-origin'
