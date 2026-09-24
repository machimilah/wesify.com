import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "FAQ", description: "Answers about Wesify markets, W$ play money, settlement and accounts.", alternates: { canonical: "/faq" } };

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "What is Wesify?", a: "A prediction game about short videos. Each market asks how many likes a video will have 24 hours after the market opened, and you trade on which like range it'll land in." },
  { q: "Is this real money?", a: "No. Wesify Credits (W$) are play money with no monetary value. You can't buy them, cash them out, transfer them or trade them for prizes." },
  { q: "How do prices work?", a: "A range's price is the market's estimated chance it wins. At 30%, a share costs W$0.30 and pays W$1.00 if that range wins. Prices move as likes come in and people trade." },
  { q: "How do I win or lose W$?", a: "When the market settles, each share of the winning range pays W$1.00 and the other ranges pay nothing. You can also sell before trading closes to lock in a gain or cut a loss." },
  { q: "When does a market close and settle?", a: "Trading closes 1 minute before the 24-hour mark. We then record the final like count and a reviewer confirms it, usually within a few hours. Winnings are paid automatically." },
  { q: "How are the four ranges chosen?", a: <>They&apos;re sized to the creator from their usual likes and follower count, so every range is still possible when the market opens. <Link href="/rules#ranges">Details</Link>.</> },
  { q: "What if the video is deleted or goes private?", a: "Trading pauses right away. If it isn't back within an hour, the market is cancelled and open positions are refunded at what you paid." },
  { q: "Why can't I buy more?", a: "To keep one tap from ending your game, a trade can use at most 20% of your cash, and at most half your portfolio can be in one market." },
  { q: "Can I open a market for a video I like?", a: "Yes. Paste its TikTok link in the search bar. New links are reviewed before they open, and the video has to be under 6 hours old." },
  { q: "I'm a creator. Can I trade on my own videos?", a: "No. Creators can't trade in markets about their own videos. You can ask for your video to be removed at any time." },
  { q: "Is Wesify affiliated with TikTok, Instagram or YouTube?", a: "No. We link to public videos on those platforms and aren't endorsed by them." },
  { q: "How do I delete my account or get my data?", a: <>In <Link href="/settings#data">Settings</Link>: &ldquo;Download my data&rdquo; and &ldquo;Delete my account&rdquo;.</> },
  { q: "Something looks wrong with my balance.", a: <>Every change is listed in your <Link href="/wallet">Wallet</Link>. If something still looks off, <Link href="/support?category=missing_credits">contact support</Link>.</> },
];

export default function FaqPage() {
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.filter((f) => typeof f.a === "string").map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  }).replace(/</g, "\\u003c");
  return (
    <LegalPage title="Frequently asked questions">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <div className="space-y-2">
        {FAQ.map((f) => (
          <details key={f.q} className="card p-4">
            <summary className="min-h-11 cursor-pointer text-base font-semibold text-ink">{f.q}</summary>
            <p className="mt-2">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-6">
        Still stuck? <Link href="/support">Contact support</Link>.
      </p>
    </LegalPage>
  );
}
