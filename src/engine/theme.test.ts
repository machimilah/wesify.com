// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyStoredTheme, applyTheme, getTheme, setTheme, toggleTheme } from './theme'

/**
 * The theme, at the unit level.
 *
 * `theme.test.mjs` already proves the toggle works in a real browser across every screen. This
 * covers the part that browser test cannot reach cheaply: what happens when localStorage holds
 * something unexpected, which is the case a returning visitor with an old or corrupted value hits.
 */
describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('is light until somebody chooses otherwise', () => {
    expect(getTheme()).toBe('light')
    applyStoredTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
  })

  it('treats anything that is not the word dark as light', () => {
    // A value from an older version, a half-written write, or another tab's key entirely. None of
    // those should leave someone staring at a theme they did not pick.
    for (const stored of ['', 'DARK', 'night', '"dark"', 'true', 'undefined']) {
      localStorage.setItem('bo-theme', stored)
      expect(getTheme(), `"${stored}" was read as dark`).toBe('light')
    }
  })

  it('writes the choice to the document root, where the CSS variables are', () => {
    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('bo-theme')).toBe('dark')

    // Light removes the attribute rather than setting it to "light": the stylesheet's default is
    // light, and an explicit attribute would win over the viewer's own system preference.
    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
  })

  it('toggles both ways and reports what it landed on', () => {
    expect(toggleTheme()).toBe('dark')
    expect(getTheme()).toBe('dark')
    expect(toggleTheme()).toBe('light')
    expect(getTheme()).toBe('light')
  })

  it('restores the stored choice before the first render', () => {
    localStorage.setItem('bo-theme', 'dark')
    applyStoredTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('applies a theme without recording it, for a preview', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('bo-theme')).toBe(null)
  })
})