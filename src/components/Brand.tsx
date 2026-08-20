import { Sparkles } from 'lucide-react'

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? 'brand--inverse' : ''}`} aria-label="BO">
      <span className="brand-mark"><Sparkles size={17} strokeWidth={2.2} /></span>
      <span>BO</span>
      <em>alpha</em>
    </div>
  )
}
