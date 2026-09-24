import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { MARKET_RULES, RULES_VERSION, CANCEL_REASONS } from "@/lib/shared/rules";

export const metadata: Metadata = {
  title: "How markets work",
  description: "The rules for every Wesify market in plain English: ranges, prices, settlement, cancellations and W$.",
  alternates: { canonical: "/rules" },
};

/** Market, settlement and cancellation rules in plain English (checklist §1, §45). */
export default function RulesPage() {
  return (
    <LegalPage title="How markets work" version={RULES_VERSION}>
      <p className="text-base text-ink">Every market follows the same rules. Each market page shows the rules version it opened under.</p>
      <nav aria-label="On this page" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {MARKET_RULES.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="badge no-underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {MARKET_RULES.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`}>
          <h2 id={`${section.id}-h`}>{section.title}</h2>
          <ul>
            {section.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ))}
      <h2 id="cancel-reasons">Why a market can be cancelled</h2>
      <ul>
        {Object.values(CANCEL_REASONS).map((r) => (
          <li key={r.label}>
            <strong>{r.label}.</strong> {r.explanation}
          </li>
        ))}
      </ul>
      <h2>Questions or disagreements</h2>
      <p>
        If you think a market settled wrong, <Link href="/support?category=settlement_dispute">ask us to review it</Link>. We check the recorded counts and reply within 2 business days.
      </p>
    </LegalPage>
  );
}
