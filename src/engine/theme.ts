/**
 * Light mode only.
 */

export type Theme = 'light'
const KEY = 'bo-theme'

export function getTheme(): Theme {
  return 'light'
}

/** Written to <html>, not <body>: a theme is a document-level fact, and CSS variables on :root see it. */
export function applyTheme(_theme: Theme) {
  document.documentElement.removeAttribute('data-theme')
}

export function setTheme(_theme: Theme) {
  // No-op: light mode only
}

export function toggleTheme(): Theme {
  return 'light'
}

/** Call once, before the first render, so nobody ever sees the wrong theme flash on load. */
export function applyStoredTheme() {
  applyTheme('light')
}
