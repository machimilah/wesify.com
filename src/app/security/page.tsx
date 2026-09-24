import Link from "next/link";
import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Security", alternates: { canonical: "/security" } };

const SECURITY = process.env.SECURITY_EMAIL ?? process.env.SUPPORT_EMAIL ?? "security@wesify.app";

/** Security contact (§43) and responsible disclosure. Mirrored in /.well-known/security.txt. */
export default function SecurityPage() {
  return (
    <LegalPage title="Security">
      <p className="text-base text-ink">If you&apos;ve found a security problem, please tell us privately first.</p>
      <h2>Report a vulnerability</h2>
      <p>
        Email <a href={`mailto:${SECURITY}`}>{SECURITY}</a> or use the <Link href="/support?category=security">security form</Link>. Include steps to reproduce. We acknowledge reports within 2 business days and keep you updated until it&apos;s fixed.
      </p>
      <h2>Please don&apos;t</h2>
      <ul>
        <li>Access or change other people&apos;s accounts or data.</li>
        <li>Run denial-of-service tests or automated scans that degrade the service.</li>
        <li>Use social engineering against our team or users.</li>
      </ul>
      <h2>How we protect accounts</h2>
      <ul>
        <li>HTTPS everywhere with strict transport security; secure, HTTP-only, same-site cookies.</li>
        <li>Passwords hashed with scrypt; accounts lock after repeated failed sign-ins.</li>
        <li>Social platform tokens encrypted at rest (AES-256-GCM) and deleted on disconnect.</li>
        <li>Every balance change is recorded in a ledger that we reconcile automatically.</li>
        <li>Admin actions are role-restricted and audited.</li>
      </ul>
    </LegalPage>
  );
}
