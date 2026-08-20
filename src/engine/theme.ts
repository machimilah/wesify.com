/**
 * Light or dark, remembered per person.
 *
 * Always light until someone chooses otherwise — a returning visitor's first paint must never
 * depend on a network round trip or a media query flicker, so the choice lives in localStorage and
 * is applied synchronously, before React mounts anything.
 */

export type Theme = 'light' | 'dark'
const KEY = 'bo-theme'

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
}

/** Written to <html>, not <body>: a theme is a document-level fact, and CSS variables on :root see it. */
export function applyTheme(theme: Theme) {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

/** Call once, before the first render, so nobody ever sees the wrong theme flash on load. */
export function applyStoredTheme() {
  applyTheme(getTheme())
}
