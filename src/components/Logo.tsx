/* eslint-disable @next/next/no-img-element */

/**
 * Renders the supplied brand asset (§41). The file is black on transparent, so a CSS filter turns
 * it white for the dark theme without altering the asset itself. The PNG has generous transparent
 * padding around the wordmark, so the image is drawn taller than the header row and pulled in with
 * negative margins to keep the letters a readable size. Falls back to plain type — never a redrawn
 * mark — if the file is missing.
 */
export function Logo({ hasLogo, className = "h-14 -my-3" }: { hasLogo: boolean; className?: string }) {
  if (hasLogo) return <img src="/brand/wesify-logo.png" alt="wesify" className={`${className} w-auto brightness-0 invert`} />;
  return <span className="text-2xl font-semibold tracking-tight text-ink">wesify</span>;
}
