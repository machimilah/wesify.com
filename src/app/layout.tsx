import fs from "node:fs";
import path from "node:path";
import type { Metadata, Viewport } from "next";
import { Google_Sans } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AppProvider } from "@/components/AppProvider";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

/**
 * Google Sans via next/font (self-hosted at build time from Google Fonts, which licenses it for
 * web use); the fallback stack in globals.css covers any environment where it can't load (§2).
 */
const googleSans = Google_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-google-sans",
  display: "swap",
});

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DESCRIPTION = "Trade the future of virality. Predict how many likes a video will get in 24 hours. Play money only: Wesify Credits have no monetary value.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "Wesify | Social Prediction Markets", template: "%s · Wesify" },
  description: DESCRIPTION,
  applicationName: "Wesify",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Wesify",
    title: "Wesify | Trade the future of virality",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: "Wesify | Trade the future of virality", description: DESCRIPTION },
  robots: { index: process.env.APP_ENV !== "staging", follow: process.env.APP_ENV !== "staging" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080809",
};

const hasLogo = fs.existsSync(path.join(process.cwd(), "public", "brand", "wesify-logo.png"));
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

/** Basic structured metadata (§64). `<` is escaped so the JSON can't close the script tag. */
const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Wesify",
  url: APP_URL,
  description: DESCRIPTION,
  publisher: { "@type": "Organization", name: "Wesify", url: APP_URL, logo: `${APP_URL}/brand/wesify-logo.png` },
}).replace(/</g, "\\u003c");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const app = (
    <AppProvider>
      <AppShell hasLogo={hasLogo}>{children}</AppShell>
    </AppProvider>
  );
  return (
    <html lang="en" className={googleSans.variable}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
        {clerkEnabled ? <ClerkProvider>{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
