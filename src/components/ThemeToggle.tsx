import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { getTheme, toggleTheme } from '../engine/theme'

/**
 * The one control for BO's whole light/dark theme.
 *
 * Placed on every screen that has its own header, rather than living only in Settings, because the
 * scope of the toggle is the whole product — landing page included — and a person should not have to
 * find their way into a signed-in workspace before they can turn the lights down.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setThemeState] = useState(getTheme)
  return <button
    type="button"
    className={`bo-theme-toggle ${className}`.trim()}
    onClick={() => setThemeState(toggleTheme())}
    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    data-testid="theme-toggle"
  >
    {theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
  </button>
}
