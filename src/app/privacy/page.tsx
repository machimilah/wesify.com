import Link from "next/link";
import type { Metadata } from "next";
import { CookieSettings } from "@/components/CookieSettings";
import { LegalPage } from "@/components/LegalPage";
import { PRIVACY_VERSION } from "@/lib/shared/rules";

export const metadata: Metadata = { title: "Privacy Policy", alternates: { canonical: "/privacy" } };

const SUPPORT = process.env.SUPPORT_EMAIL ?? "support@wesify.app";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 2026" version={PRIVACY_VERSION} draft>
      <p className="text-base text-ink">We collect only what Wesify needs to run a fair game, keep accounts secure and improve the product. We don&apos;t sell your data, and we don&apos;t use advertising trackers.</p>

      <h2>What we collect, and why</h2>
      <ul>
        <li><strong>Account:</strong> email, username, a hashed password (or your sign-in provider&apos;s account id), age confirmation and when you accepted our terms. To run your account and prove consent.</li>
        <li><strong>Activity:</strong> your trades, positions, W$ history, notifications and settings. This is the game itself.</li>
        <li><strong>Security signals:</strong> a random device identifier cookie, a salted hash of your IP address, browser type and sign-in times. To protect accounts and detect multiple accounts, bots and manipulation. We don&apos;t store raw IP addresses in our database.</li>
        <li><strong>Product analytics (only with your consent):</strong> which screens you view and how you use features, so we can fix confusing parts.</li>
        <li><strong>Connected social accounts (only if you connect one):</strong> your public handle, follower count, your recent videos&apos; links, captions, post times and like counts, and an encrypted access token. To verify which videos are yours, keep you out of markets on your own videos, and, for creators in our program, open markets on your videos.</li>
        <li><strong>Support messages</strong> you send us.</li>
      </ul>
      <p>We don&apos;t collect precise location, contacts, photos or payment details. We never ask for them.</p>

      <h2>Public video data</h2>
      <p>Markets use public information about videos: the link, the creator&apos;s public handle, platform-provided thumbnails and like counts. We link to videos on their platform and don&apos;t host copies. Creators can ask us to remove a video at any time.</p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Hosting and storage provider (where Wesify runs and backups are kept).</li>
        <li>Email delivery provider (verification, password reset and the notifications you choose).</li>
        <li>Sign-in provider, if enabled (account credentials and verification).</li>
        <li>Bot-protection provider, if enabled (a challenge on sign-up forms).</li>
        <li>Product analytics provider, if enabled and only with your consent.</li>
      </ul>
      <p>The current list of named processors is available on request. We share data with authorities only when legally required.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account data: until you delete your account.</li>
        <li>Trades and W$ history: kept in anonymized form after deletion, because other players&apos; market results depend on them.</li>
        <li>Security logs and sessions: up to 30 days after they expire.</li>
        <li>Analytics events: up to 180 days.</li>
        <li>Backups: up to 30 days, then overwritten.</li>
        <li>Support messages: up to 2 years after the ticket is closed.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li><strong>Access / export:</strong> download everything we hold about you in <Link href="/settings#data">Settings → Download my data</Link>.</li>
        <li><strong>Deletion:</strong> delete your account in <Link href="/settings#data">Settings</Link>. We erase your email, password, sessions, tokens and connected accounts immediately.</li>
        <li><strong>Correction and other requests:</strong> contact us through <Link href="/support?category=privacy_request">support</Link>. We reply within 30 days.</li>
        <li><strong>Marketing email:</strong> only with your opt-in; every email has an unsubscribe link.</li>
        <li><strong>Disconnect social accounts</strong> at any time; we delete the token and ask the platform to revoke it.</li>
      </ul>

      <h2 id="cookies">Cookies</h2>
      <p>
        <strong>Necessary</strong> (always on): your sign-in session, security and device cookies, and your cookie choice. <strong>Analytics</strong> (optional): lets us record product events tied to your visit. <strong>Marketing:</strong> we don&apos;t use advertising cookies.
      </p>
      <CookieSettings />

      <h2>Security</h2>
      <p>Passwords are hashed, platform tokens are encrypted at rest, traffic is HTTPS-only, and backups are encrypted. Report issues on our <Link href="/security">Security page</Link>.</p>

      <h2>Children</h2>
      <p>Wesify is for adults 18 and over. We don&apos;t knowingly collect data from children; if you believe a child has an account, contact us and we&apos;ll delete it.</p>

      <h2>Contact</h2>
      <p>
        <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a> · [To be completed by counsel: controller entity name, address, and any required representative.]
      </p>
    </LegalPage>
  );
}
