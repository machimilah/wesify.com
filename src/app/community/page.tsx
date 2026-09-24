import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Community rules", alternates: { canonical: "/community" } };

/** Community rules (§45, §49). Wesify has no comments in V1, so rules cover usernames, conduct and fair play. */
export default function CommunityPage() {
  return (
    <LegalPage title="Community rules" updated="September 2026" draft>
      <p className="text-base text-ink">Wesify is a game about predicting what the internet will do. Keep it fair and keep it kind.</p>
      <h2>Play fair</h2>
      <ul>
        <li>One account per person. No bots, scripts or automated trading.</li>
        <li>Don&apos;t buy likes, use engagement pods or otherwise push a video&apos;s numbers to win a market.</li>
        <li>Don&apos;t trade on your own videos, or ask someone to trade for you.</li>
        <li>Don&apos;t exploit bugs. If you find one, <Link href="/support?category=security">tell us</Link>.</li>
        <li>Don&apos;t farm referrals with fake or duplicate accounts.</li>
      </ul>
      <h2>Respect people</h2>
      <ul>
        <li>Wesify is about videos, not about targeting people. Don&apos;t harass creators or ask others to pile on to change a result.</li>
        <li>Usernames can&apos;t be offensive, impersonate someone, or pretend to be Wesify staff.</li>
        <li>Don&apos;t submit videos that are sexual, violent, hateful, dangerous, illegal, or that feature children in a way that puts them at risk.</li>
      </ul>
      <h2>What we do</h2>
      <p>
        We review reports and unusual activity. We may pause markets, freeze trading on an account while we look into it, rename or remove usernames, remove videos, reverse trades or rewards, and suspend accounts. A person always reviews before any permanent action, and you can{" "}
        <Link href="/support?category=appeal">appeal</Link>.
      </p>
      <p>
        See something wrong? Use &ldquo;Report&rdquo; on the market page or <Link href="/support?category=abuse_report">contact us</Link>.
      </p>
    </LegalPage>
  );
}
