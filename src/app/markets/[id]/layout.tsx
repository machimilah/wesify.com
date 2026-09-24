import type { Metadata } from "next";
import { getMainWorld } from "@/server/store";

/**
 * Server-side metadata for market pages (§64): a descriptive title and Open Graph tags so shared
 * links unfurl with the market card. Markets only live 24 hours, so they're `noindex` for search
 * while still following links; canonical URLs point at the market itself.
 */
export async function generateMetadata({ params }: LayoutProps<"/markets/[id]">): Promise<Metadata> {
  const { id } = await params;
  const world = getMainWorld();
  const market = world.state.markets[id];
  const video = market ? world.state.videos[market.videoId] : undefined;
  if (!market || !video || market.hidden || market.status === "DRAFT") return { title: "Market", robots: { index: false } };
  const top = [...world.state.outcomes[id]].sort((a, b) => b.currentPrice - a.currentPrice)[0];
  const title = `@${video.creatorHandle}: likes in 24 hours`;
  const description = `${top.label} leads at ${Math.round(top.currentPrice * 100)}%. Trade the future of virality with play money on Wesify.`;
  return {
    title,
    description,
    alternates: { canonical: `/markets/${id}` },
    robots: { index: false, follow: true },
    openGraph: { title, description, url: `/markets/${id}`, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function MarketLayout({ children }: LayoutProps<"/markets/[id]">) {
  return children;
}
