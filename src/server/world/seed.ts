import { SNAPSHOT_INTERVAL_MS } from "@/lib/shared/constants";
import { mulberry32 } from "@/lib/shared/random";
import type { MetricSnapshot, ScenarioName } from "@/lib/shared/types";
import { simulatedLikes } from "@/lib/simulation/trajectories";
import type { Ctx } from "./context";
import { createMarket } from "./markets";
import { createUser } from "./users";

const HOUR = 3_600_000;

const HANDLES = [
  "maya.moves", "chefnico", "dailydosewithdre", "skatepark.sam", "lena.lipsyncs", "gymtok.gio",
  "plantmom.priya", "retro.rico", "coldbrew.cam", "vibecheck.val", "tinykitchen.tae", "nightowl.nora",
  "sneakerlab.sol", "thriftqueen.tia", "dogdad.dev", "lofi.lucas", "streetfood.sofi", "danceduo.jj",
  "study.with.ren", "fixit.felix", "glowup.gabi", "catcafe.kai", "roadtrip.rae", "magic.marco",
  "bookish.bea", "prank.pablo", "diy.dani", "surf.sienna", "comedy.cole", "art.by.ari",
];

const CAPTIONS = [
  "wait for the ending", "POV: first day at the new job", "this recipe broke my brain", "trying the viral trend",
  "tell me you didn't see that coming", "rate this fit 1–10", "the dog knew", "day 47 of learning guitar",
  "we did it in one take", "my grandma reacts", "this hack actually works", "street interview gone right",
  "nobody talks about this", "the plot twist", "can't stop replaying this", "3am thoughts",
];

export const BOT_NAMES = [
  "sim.oracle", "sim.trendhawk", "sim.earlybird", "sim.fyp_scout", "sim.likehunter", "sim.viralvera",
  "sim.quietquant", "sim.hypecheck", "sim.algowatch", "sim.scrollsage", "sim.clipcaller", "sim.tapper",
];

const SCENARIO_MIX: ScenarioName[] = [
  "viral-spike", "slow-growth", "spike-decay", "stable-mid", "late-spike", "flat", "fake-spike",
  "slow-growth", "stable-mid", "viral-spike", "late-spike", "spike-decay", "double-spike",
];

const SCALE_RANGE: Record<ScenarioName, [number, number]> = {
  flat: [0.6, 3],
  "slow-growth": [0.5, 2.2],
  "viral-spike": [0.3, 1.3],
  "spike-decay": [0.4, 1.4],
  "late-spike": [0.4, 1.8],
  "fake-spike": [0.6, 1.8],
  "stable-mid": [0.4, 2.5],
  "double-spike": [0.4, 1.6],
};

/** Builds a TikTok-shaped video ID whose top 32 bits encode the publish time. */
function tiktokStyleId(publishedAt: number, rnd: () => number): string {
  const seconds = BigInt(Math.floor(publishedAt / 1000));
  const low = BigInt(Math.floor(rnd() * 0xffffffff));
  return ((seconds << BigInt(32)) | low).toString();
}

export function createSimulatedMarket(
  ctx: Ctx,
  input: { scenario: ScenarioName; openedAt: number; seed: number; handle?: string; actor?: string | null; ageHours?: number; scale?: number },
) {
  const rnd = mulberry32(input.seed);
  const publishedAt = input.openedAt - (input.ageHours ?? 0.3 + rnd() * 4.5) * HOUR;
  const [lo, hi] = SCALE_RANGE[input.scenario];
  const scale = input.scale ?? lo + rnd() * (hi - lo);
  const handle = input.handle ?? HANDLES[Math.floor(rnd() * HANDLES.length)];
  const platformVideoId = tiktokStyleId(publishedAt, rnd);
  const params = { scenario: input.scenario, seed: input.seed, scale, openedAt: input.openedAt, publishedAt };

  const history: MetricSnapshot[] = [];
  for (let t = publishedAt + SNAPSHOT_INTERVAL_MS; t < input.openedAt; t += SNAPSHOT_INTERVAL_MS) {
    history.push({ capturedAt: t, likes: simulatedLikes(params, t) });
  }
  history.push({ capturedAt: input.openedAt, likes: simulatedLikes(params, input.openedAt) });
  const baseline = simulatedCreatorBaseline(input.seed, scale);

  return createMarket(ctx, {
    video: {
      platform: "tiktok",
      platformVideoId,
      canonicalUrl: `https://www.tiktok.com/@${handle}/video/${platformVideoId}`,
      creatorHandle: handle,
      caption: CAPTIONS[Math.floor(rnd() * CAPTIONS.length)],
      thumbnailHue: 205 + Math.floor(rnd() * 80),
      publishedAt,
      provider: "mock",
      scenario: input.scenario,
      seed: input.seed,
      scale,
    },
    openedAt: input.openedAt,
    initialHistory: history,
    actor: input.actor ?? "system",
    source: input.actor === "admin" ? "admin" : "system",
    baseline,
    skipEligibility: true,
  });
}

/**
 * A plausible creator for a simulated video: average likes around the trajectory's scale (so some
 * videos beat the creator's usual numbers and some don't), and a follower count consistent with a
 * 2–8% like rate. Feeds the range formula like a real creator's stats would.
 */
export function simulatedCreatorBaseline(seed: number, scale: number): { followers: number; avgLikes: number } {
  const rnd = mulberry32(seed ^ 0x5eed);
  const avgLikes = Math.round(40_000 * scale * Math.exp((rnd() - 0.5) * 1.6));
  const followers = Math.round(avgLikes / (0.02 + rnd() * 0.06));
  return { followers, avgLikes: Math.max(600, avgLikes) };
}

/** A seed handle not already running an open market, so the feed stays diverse (§23). */
export function pickFreshHandle(ctx: Ctx): string {
  const busy = new Set(
    Object.values(ctx.state.markets)
      .filter((m) => m.status === "OPEN" || m.status === "PAUSED")
      .map((m) => ctx.state.videos[m.videoId]?.creatorHandle),
  );
  const free = HANDLES.filter((h) => !busy.has(h));
  const pool = free.length ? free : HANDLES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function ensureBots(ctx: Ctx, count: number) {
  for (const name of BOT_NAMES.slice(0, count)) {
    if (!ctx.state.usernames[name]) createUser(ctx, { username: name, isBot: true });
  }
}

let seedCounter = Date.now() % 1_000_000;
export const nextSeed = () => ++seedCounter * 2654435761 >>> 0;

/** Main world: bots plus staggered markets so the feed has markets at every stage (§47). */
export function seedMainWorld(ctx: Ctx, count: number) {
  ensureBots(ctx, BOT_NAMES.length);
  const now = ctx.now();
  for (let i = 0; i < count; i++) {
    const scenario = SCENARIO_MIX[i % SCENARIO_MIX.length];
    const openedAt = now - ((i * 22) / count) * HOUR - Math.random() * 20 * 60_000;
    createSimulatedMarket(ctx, { scenario, openedAt, seed: nextSeed(), handle: HANDLES[i % HANDLES.length] });
  }
}

/** Demo world: the five §89 scenarios, all opening now. */
export function seedDemoWorld(ctx: Ctx) {
  ensureBots(ctx, 6);
  const now = ctx.now();
  const demo: [ScenarioName, string, number][] = [
    ["slow-growth", "study.with.ren", 1.2],
    ["viral-spike", "maya.moves", 0.85],
    ["spike-decay", "chefnico", 1],
    ["stable-mid", "plantmom.priya", 1.4],
    ["late-spike", "skatepark.sam", 1],
  ];
  demo.forEach(([scenario, handle, scale], i) =>
    createSimulatedMarket(ctx, { scenario, handle, scale, openedAt: now, seed: nextSeed() + i, ageHours: 1 }),
  );
}
