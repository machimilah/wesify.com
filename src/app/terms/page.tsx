import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { TERMS_VERSION } from "@/lib/shared/rules";

export const metadata: Metadata = { title: "Terms of Use", alternates: { canonical: "/terms" } };

const SUPPORT = process.env.SUPPORT_EMAIL ?? "support@wesify.app";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="September 2026" version={TERMS_VERSION} draft>
      <p className="text-base font-semibold text-ink">Wesify is a free game played with play money. Wesify Credits (W$) have no monetary value.</p>

      <h2>1. Who can use Wesify</h2>
      <p>You must be at least 18 years old and able to agree to these terms. One account per person. You&apos;re responsible for keeping your password safe and for what happens on your account.</p>

      <h2>2. Wesify Credits (W$) are play money</h2>
      <ul>
        <li>W$ is a virtual score used only inside Wesify. It has no monetary value.</li>
        <li>You can&apos;t buy W$, and W$ can&apos;t be redeemed, withdrawn, sold, or exchanged for cash, crypto, gift cards, goods or prizes of any kind.</li>
        <li>W$ can&apos;t be transferred to another account or outside Wesify.</li>
        <li>We may adjust balances to correct errors, reverse the effect of bugs or abuse, or reset the game. Your W$ balance is not property.</li>
        <li>Nothing on Wesify is gambling, investment or financial advice. Market prices are forecasts from a model and other players, not promises.</li>
      </ul>

      <h2>3. Markets</h2>
      <p>
        Each market is about one public video and settles on its like count 24 hours after the market opened, under the rules shown on the market page and at{" "}
        <Link href="/rules">How markets work</Link>. Those rules (including settlement, review, boundaries, rounding and cancellation) are part of these terms. The version that applies to a market is the one shown on it when it opened.
      </p>

      <h2>4. Settlement and cancellation</h2>
      <p>
        We record the final like count from the data source shown on the market and a reviewer confirms it before paying out. If a video is deleted or made private, if reliable data isn&apos;t available, if a market was set up incorrectly, or if we find manipulation, we may cancel the market and refund open positions at cost. Our settlement decision is final, but you can ask us to review it through <Link href="/support">support</Link>.
      </p>

      <h2>5. Fair play</h2>
      <ul>
        <li>Don&apos;t manipulate likes or views (bought engagement, bots, engagement pods) on any video with a market.</li>
        <li>Creators can&apos;t trade in markets about their own videos, directly or through anyone else.</li>
        <li>No multiple accounts, automated trading, scraping, exploiting bugs, or referral farming.</li>
        <li>Follow the <Link href="/community">Community rules</Link>.</li>
      </ul>
      <p>If we believe you broke these rules, we may freeze trading on your account while we review, reverse affected trades or rewards, remove content, suspend or close your account. We don&apos;t permanently punish anyone automatically without a human review, and you can appeal through support.</p>

      <h2>6. Videos and creators</h2>
      <p>
        Videos belong to their creators. Wesify links to them on the original platform and shows platform-provided thumbnails with attribution; we don&apos;t download or host copies. Creators can ask us to remove their video at any time through <Link href="/support?category=creator_takedown">support</Link>. We may remove any content for any lawful reason.
      </p>
      <p>Wesify isn&apos;t affiliated with, endorsed by or sponsored by TikTok, Instagram, YouTube or their owners. Their names and trademarks belong to them.</p>

      <h2>7. Connected accounts</h2>
      <p>If you connect a social account, you allow Wesify to read the data described when you connect (your profile, follower count, recent videos and their like counts). You can disconnect at any time; we then delete the access token and ask the platform to revoke it.</p>

      <h2>8. Changes and availability</h2>
      <p>Wesify is in early access and may change, pause or stop. We can pause trading, change features or update these terms. If we make a material change we&apos;ll tell you in the app, and running markets keep the rules they opened with.</p>

      <h2>9. Liability</h2>
      <p>Wesify is provided &ldquo;as is&rdquo;. To the extent the law allows, we aren&apos;t liable for indirect losses, lost data, or anything related to W$, which has no value. Nothing here limits rights you have under consumer law that can&apos;t be limited.</p>

      <h2>10. Ending your account</h2>
      <p>You can delete your account at any time in <Link href="/settings#data">Settings</Link>. We may suspend or close accounts that break these terms.</p>

      <h2>11. Governing law</h2>
      <p>[To be completed by counsel: governing law and venue for the entity that operates Wesify.]</p>

      <h2>12. Contact</h2>
      <p>
        Questions: <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> or the <Link href="/support">support form</Link>. See also our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
