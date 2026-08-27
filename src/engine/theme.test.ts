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

  it('is always light', () => {
    expect(getTheme()).toBe('light')
    applyStoredTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
  })

  it('removes data-theme attribute', () => {
    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
  })

  it('toggles and reports light', () => {
    expect(toggleTheme()).toBe('light')
    expect(getTheme()).toBe('light')
  })

  it('applies light theme before first render', () => {
    applyStoredTheme()
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
  })

  it('applies light theme without recording', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe(null)
    expect(localStorage.getItem('bo-theme')).toBe(null)
  })
})