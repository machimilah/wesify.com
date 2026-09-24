import { normalize } from "@/lib/virality-engine";
import type { Ctx } from "./context";
import { postLedger } from "./ledger";
import { buy, sell, tradeLimits } from "./trading";

/**
 * Simulated crowd traders. Each holds a noisy private belief around the model and trades when
 * the market price disagrees with it, which gives prices a crowd component (§19) in simulation.
 * Bots are labelled "sim." everywhere they appear.
 */
export function maybeBotTrade(ctx: Ctx, marketId: string, rnd: () => number = Math.random, chance = 0.3) {
  if (rnd() > chance) return;
  const bots = Object.values(ctx.state.users).filter((u) => u.isBot);
  if (bots.length === 0) return;
  const bot = bots[Math.floor(rnd() * bots.length)];
  const outcomes = ctx.state.outcomes[marketId];

  if (bot.creditsBalance < 1500) {
    postLedger(ctx, { userId: bot.id, type: "ADMIN_ADJUSTMENT", amount: 5000, referenceType: "bot_refill", referenceId: bot.id });
  }

  const gaussian = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const belief = normalize(outcomes.map((o) => o.modelProbability * Math.exp(0.35 * gaussian())));

  // Edges are absolute probability gaps; ratio edges would systematically favor long shots.
  try {
    // Take profit / cut positions the bot no longer believes in.
    for (const o of outcomes) {
      const pos = ctx.state.positions[`${bot.id}|${marketId}|${o.id}`];
      const i = outcomes.indexOf(o);
      if (pos && pos.shares > 1e-6 && o.currentPrice - belief[i] > 0.03 && rnd() < 0.7) {
        sell(ctx, { userId: bot.id, marketId, outcomeId: o.id, shares: pos.shares * (0.4 + rnd() * 0.6) });
        return;
      }
    }
    let best = -1;
    let bestEdge = 0.04;
    outcomes.forEach((o, i) => {
      const edge = belief[i] - o.currentPrice;
      if (edge > bestEdge) {
        bestEdge = edge;
        best = i;
      }
    });
    if (best < 0) return;
    const limits = tradeLimits(ctx, bot.id, marketId);
    const credits = Math.min(limits.maxBuy, 60 + rnd() * 340);
    if (credits >= 1) buy(ctx, { userId: bot.id, marketId, outcomeId: outcomes[best].id, credits });
  } catch {
    // Bots never surface errors (e.g. limits hit, market closed).
  }
}
