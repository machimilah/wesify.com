import type { ReactNode } from "react";

/** Shared layout for legal and help pages. `draft` shows the counsel-review notice (§47). */
export function LegalPage({ title, updated, version, draft = false, children }: { title: string; updated?: string; version?: string; draft?: boolean; children: ReactNode }) {
  return (
    <article className="prose-legal mx-auto max-w-3xl pt-6 text-sm text-ink-soft">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">{title}</h1>
      {(updated || version) && (
        <p className="mt-1 text-xs text-muted">
          {updated && `Last updated ${updated}`}
          {updated && version && " · "}
          {version && `Version ${version}`}
        </p>
      )}
      {draft && (
        <p className="notice notice-warning mt-4">
          Pre-launch draft. This text is written in plain English for review by counsel before Wesify opens to the public.
        </p>
      )}
      <div className="mt-4">{children}</div>
    </article>
  );
}
