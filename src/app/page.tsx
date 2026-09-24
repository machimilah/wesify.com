"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { SearchIcon } from "@/components/AppShell";
import { MarketCard } from "@/components/MarketCard";
import { MarketRow } from "@/components/MarketRow";
import { GENRES, genreOf } from "@/lib/shared/genres";
import { PriceChart } from "@/components/PriceChart";
import { Empty, ErrorState, MomentumBadge, PlatformBadge, SERIES_COLORS, Skeleton, Tabs, Thumbnail } from "@/components/ui";
import { ApiError, api } from "@/lib/client/api";
import { WatchOriginal } from "@/components/WatchOriginal";
import { usePoll, useWorldNow } from "@/lib/client/hooks";
import type { MarketCardDTO } from "@/lib/shared/dto";
import { compactNumber, duration, percent } from "@/lib/shared/format";

type Feed = { open: MarketCardDTO[]; recent: MarketCardDTO[]; total: number; nextOffset: number | null };
type Category = "trending" | "new" | "movers" | "closing" | "settled";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "new", label: "New" },
  { value: "movers", label: "Biggest movers" },
  { value: "closing", label: "Closing soon" },
  { value: "settled", label: "Settled" },
];

const PAGE = 60;

export default function MarketsPage() {
  const router = useRouter();
  const { me, toast, search, setSearch } = useApp();
  const [debounced, setDebounced] = useState(search);
  const [category, setCategory] = useState<Category>("trending");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setLimit(PAGE), [category, debounced]);

  // After sign-up: resume a link shared before the account existed, and keep the tutorial request
  // for the first market page.
  useEffect(() => {
    if (!me) return;
    try {
      if (new URLSearchParams(window.location.search).get("tutorial") === "1") sessionStorage.setItem("wesify_tutorial", "1");
      const pending = sessionStorage.getItem("wesify_pending_share");
      if (pending) {
        sessionStorage.removeItem("wesify_pending_share");
        router.push(`/share-target?url=${encodeURIComponent(pending)}`);
      }
    } catch {}
  }, [me, router]);

  const sort = category === "settled" ? "trending" : category;
  const qs = new URLSearchParams({ sort, limit: String(limit) });
  if (debounced) {
    qs.set("q", debounced);
    qs.set("track", "1");
  }
  const { data, loading, error, refresh, updatedAt, stale } = usePoll<Feed>(`/api/markets?${qs.toString()}`);

  const markets = useMemo(() => (data ? (category === "settled" ? data.recent : data.open) : []), [data, category]);
  const looksLikeUrl = /(tiktok\.com|instagram\.com|youtube\.com|youtu\.be)\//i.test(search);
  const featured = category === "trending" && !debounced ? markets[0] : undefined;
  const grid = featured ? markets.slice(1) : markets;

  return (
    <div className="pt-3">
      {/* The header search only fits from lg up; below that the page carries its own. */}
      <label className="relative mb-2 block lg:hidden">
        <span className="sr-only">Search markets</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search @creator or paste a TikTok link"
          className="input pl-9"
        />
      </label>

      <div className="flex items-end justify-between gap-3">
        <Tabs label="Categories" value={category} onChange={setCategory} options={CATEGORIES} />
        {updatedAt && (
          <p className={`tabular hidden shrink-0 pb-3 text-xs sm:block ${stale ? "text-warning" : "text-muted"}`} aria-live="polite">
            {stale ? "Reconnecting… prices may be out of date" : "Live · updates every 10s"}
          </p>
        )}
      </div>

      {looksLikeUrl && <PasteLink url={search} onDone={(id) => router.push(`/markets/${id}`)} onError={toast} signedIn={Boolean(me)} />}

      {loading && !data && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading markets">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}

      {error && !data && <ErrorState title="Couldn't load markets." message={error.message} onRetry={() => void refresh()} />}

      {featured && (
        <div className="mt-5 flex flex-col items-stretch gap-4 md:flex-row">
          <FeaturedMarket market={featured} />
          <div className="hidden w-52 shrink-0 flex-col gap-3 md:flex lg:w-60 lg:gap-4 xl:w-72">
            <ShareToWesifyCard />
            <HowItWorksCard />
            <LeaderboardTeaserCard />
            <PlayMoneyCard />
          </div>
        </div>
      )}

      {data && featured && (
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_210px] md:gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <MarketRow id="row-trending" title="Trending" markets={grid.slice(0, 12)} />
            {GENRES.map((g) => (
              <MarketRow key={g.value} id={`row-${g.value}`} title={g.label} markets={grid.filter((m) => genreOf(m.video.id) === g.value)} />
            ))}
          </div>
          <HomeSidebar markets={grid} />
        </div>
      )}

      {data && !featured && (
        <>
          {grid.length > 0 && (
            <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">
              {debounced ? `Results (${category === "settled" ? grid.length : data.total})` : CATEGORIES.find((c) => c.value === category)?.label}
            </h2>
          )}
          <section aria-label="Markets" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grid.map((m) => (
              <MarketCard key={m.id} market={m} />
            ))}
          </section>
          {category !== "settled" && data.nextOffset !== null && (
            <div className="mt-6 text-center">
              <button type="button" className="btn btn-secondary" onClick={() => setLimit(limit + PAGE)}>
                Show more markets
              </button>
            </div>
          )}
          {markets.length === 0 && (
            <Empty title={debounced ? "No markets match." : "Nothing here right now."}>
              {debounced ? "Try a creator handle, a caption word, or paste a TikTok link to open a market." : "New markets open all the time. Check another category."}
            </Empty>
          )}
        </>
      )}
    </div>
  );
}

function FeaturedMarket({ market }: { market: MarketCardDTO }) {
  const now = useWorldNow();
  const { data } = usePoll<{ outcomes: { id: string; label: string; price: number; change1h: number | null }[] }>(`/api/markets/${market.id}`);
  const outcomes = data?.outcomes ?? market.topOutcomes;
  const ranked = [...outcomes].sort((a, b) => b.price - a.price);
  const href = `/markets/${market.id}`;

  return (
    <section aria-label="Featured market" className="card flex min-w-0 flex-1 flex-col p-4 lg:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <PlatformBadge platform={market.video.platform} />
        <MomentumBadge label={market.momentum.label} />
      </div>
      <Link href={href} className="mt-2">
        <h2 className="text-base font-semibold leading-snug tracking-tight md:text-lg">How many likes will @{market.video.creatorHandle}’s video have after 24 hours?</h2>
        <p className="tabular mt-0.5 text-xs text-muted">
          {compactNumber(market.currentLikes)} likes · opened {duration(now - market.openedAt)} ago
        </p>
      </Link>

      <div className="mt-3 flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:gap-5 md:gap-3 lg:gap-5">
        <div className="flex w-36 shrink-0 flex-col gap-2 sm:w-40 md:w-28 lg:w-36 xl:w-48">
          <Link href={href} aria-label={`@${market.video.creatorHandle} market`}>
            <Thumbnail
              hue={market.video.thumbnailHue}
              caption={market.video.caption}
              seed={market.video.simulated ? market.video.id : undefined}
              src={market.video.thumbnailUrl}
              className="aspect-[9/16] w-full"
            />
          </Link>
          <WatchOriginal market={market} surface="featured" />
        </div>

        <div className="h-[260px] w-full min-w-0 flex-1 sm:h-auto sm:self-stretch">
          <PriceChart marketId={market.id} outcomes={outcomes} height={260} legend={false} fill span={{ from: market.openedAt, to: market.settlesAt }} />
        </div>

        <ul className="w-full shrink-0 space-y-2 sm:flex sm:h-auto sm:w-32 sm:flex-col sm:justify-between sm:space-y-0 sm:self-stretch md:w-32 xl:w-40">
          {ranked.slice(0, 4).map((o, i) => (
            <li key={o.id} className="pb-2 last:pb-0">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.label}</span>
                <span className="tabular text-sm font-semibold" style={i === 0 ? { color: SERIES_COLORS[0] } : undefined}>
                  {percent(o.price)}
                </span>
              </div>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-wash" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(3, Math.round(o.price * 100))}%`, background: i === 0 ? SERIES_COLORS[0] : "#3a3a40" }} />
              </span>
              <Link href={`${href}?outcome=${o.id}`} className={`btn-outcome tabular mt-1.5 w-full ${i === 1 ? "btn-outcome-alt" : ""}`} aria-label={`Buy ${o.label}`}>
                Buy
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="tabular mt-3 flex flex-wrap items-center gap-2.5 text-xs text-muted">
        <span>W${compactNumber(market.volume)} vol</span>
        <span>{market.traders} traders</span>
        <span>Closes in {duration(market.settlesAt - now)}</span>
      </div>
    </section>
  );
}

/** Right-hand sidebar beside the home page rows (desktop only): genre shortcuts and top movers. */
function HomeSidebar({ markets }: { markets: MarketCardDTO[] }) {
  const movers = [...markets].sort((a, b) => b.biggestMove1h - a.biggestMove1h).slice(0, 5);

  return (
    <aside aria-label="Browse" className="hidden min-w-0 md:block">
      <div className="sticky top-20 mt-10 space-y-6">
        <nav aria-label="Genres">
          <ul className="space-y-1">
            {GENRES.map((g) => {
              const count = markets.filter((m) => genreOf(m.video.id) === g.value).length;
              return (
                <li key={g.value}>
                  <a href={`#row-${g.value}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-wash">
                    <span className="bg-gradient-main grid size-10 shrink-0 place-items-center rounded-lg text-sm font-bold" aria-hidden="true">
                      {g.label.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-muted">Genre</span>
                      <span className="block font-semibold">{g.label}</span>
                    </span>
                    <span className="tabular hidden text-sm text-muted xl:inline">{count} markets</span>
                    <span aria-hidden="true" className="text-muted">›</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="pt-2">
          <h2 className="px-3 text-base font-semibold text-ink-soft">Biggest movers</h2>
          <ul className="mt-3 space-y-1">
            {movers.map((m) => {
              const top = [...m.topOutcomes].sort((a, b) => Math.abs(b.change1h ?? 0) - Math.abs(a.change1h ?? 0))[0];
              if (!top) return null;
              return (
                <li key={m.id}>
                  <Link href={`/markets/${m.id}?outcome=${top.id}`} className="block rounded-xl px-3 py-2.5 hover:bg-wash">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold">{top.label}</span>
                      <span className="tabular font-semibold">{percent(top.price)}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-muted">@{m.video.creatorHandle}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}

/** Explains the share flow (§15): paste a link, or share from TikTok on Android. */
function ShareToWesifyCard() {
  return (
    <aside aria-label="Open a market" className="bg-gradient-main relative flex shrink-0 flex-col justify-between gap-3 overflow-hidden rounded-xl p-4 lg:p-5 xl:h-44">
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-black/5" aria-hidden="true" />
      <div className="relative">
        <p className="text-lg font-semibold tracking-tight">Spotted a video early?</p>
        <p className="mt-1.5 text-sm opacity-90">Paste its TikTok link in the search bar to open a market. We review new links before they go live.</p>
      </div>
    </aside>
  );
}

function HowItWorksCard() {
  const steps = ["Pick a like range", "Buy shares with W$", "Sell any time, or hold to settlement"];
  return (
    <div className="card flex flex-[3] flex-col justify-center rounded-xl p-4 lg:p-5">
      <p className="text-sm font-semibold text-ink-soft">How it works</p>
      <ol className="mt-3 space-y-2.5">
        {steps.map((step, i) => (
          <li key={step} className="flex items-center gap-2.5 text-sm">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-wash text-[11px] font-semibold text-ink-soft">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <Link href="/rules" className="mt-3 text-sm font-semibold text-crimson-soft">
        Full rules →
      </Link>
    </div>
  );
}

function LeaderboardTeaserCard() {
  return (
    <Link href="/leaderboard" className="card card-hover flex flex-[2] flex-col justify-center gap-1 rounded-xl p-4 lg:p-5">
      <p className="text-sm font-semibold text-ink-soft">Leaderboard</p>
      <p className="text-base font-semibold">See who&apos;s calling it best →</p>
    </Link>
  );
}

function PlayMoneyCard() {
  return (
    <div className="card flex flex-1 flex-col justify-center rounded-xl p-4">
      <p className="text-xs text-muted">Wesify Credits have no monetary value. Play money only.</p>
    </div>
  );
}

function PasteLink({ url, onDone, onError, signedIn }: { url: string; onDone: (id: string) => void; onError: (m: string) => void; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useApp();
  const submit = async () => {
    if (!signedIn) return router.push("/welcome");
    setBusy(true);
    try {
      const r = await api<{ marketId: string; created: boolean; status: string }>("/api/markets", { method: "POST", body: { url: url.trim(), source: "paste" } });
      if (r.status === "DRAFT") toast(r.created ? "Sent for review. We'll notify you when it opens." : "This video is already waiting for review.");
      else if (!r.created) toast("There's already a market for this video.");
      onDone(r.marketId);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "We cannot track this video yet. Try another link.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card animate-rise mt-4 flex items-center justify-between gap-3 p-4">
      <p className="text-sm font-medium">Open a market for this video</p>
      <button onClick={submit} disabled={busy} className="btn btn-primary shrink-0">
        {busy ? "Checking…" : "Open market"}
      </button>
    </div>
  );
}
