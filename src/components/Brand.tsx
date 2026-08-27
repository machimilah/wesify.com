export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? 'brand--inverse' : ''}`} aria-label="Wesify">
      <span className="brand-mark"><img className="brand-logo brand-logo--white" src="/nobg.png" alt="Wesify" /></span>
      <em>alpha</em>
    </div>
  )
}
