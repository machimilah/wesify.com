import { Moon } from 'lucide-react'
import { getTheme } from '../engine/theme'

/**
 * Light mode only. This component is kept for backwards compatibility but renders nothing.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = getTheme()
  return <button
    type="button"
    className={`bo-theme-toggle ${className}`.trim()}
    disabled
    aria-label="Light mode only"
    title="Light mode"
    data-testid="theme-toggle"
    style={{ display: 'none' }}
  >
    <Moon size={16}/>
  </button>
}
