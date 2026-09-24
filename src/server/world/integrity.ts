import type { WorldState } from "./state";

/**
 * Reconciliation and integrity checks (checklist §10, §20, §25, §75). Pure over a state object, so
 * the same code runs in the admin balance audit, `npm run reconcile`, backup verification and the
 * hourly job. Any issue here is a launch blocker: balances, settlement and market state must agree.
 */
export type IntegrityIssue = { check: string; entity: string; detail: string };

export type IntegrityReport = {
  ok: boolean;
  checkedAt: number;
  users: number;
  markets: number;
  ledgerRows: number;
  issues: IntegrityIssue[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function checkIntegrity(state: WorldState, now = Date.now()): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const add = (check: string, entity: string, detail: string) => {
    if (issues.length < 500) issues.push({ check, entity, detail });
  };

  // 1. Every balance equals its ledger sum, balanceAfter chains correctly, and nothing is negative.
  const running = new Map<string, number>();
  for (const row of state.ledger) {
    const prev = running.get(row.userId) ?? 0;
    const next = cents(prev + row.amount);
    if (Math.abs(next - row.balanceAfter) > 0.005) add("ledger_chain", row.userId, `row ${row.id}: expected balanceAfter ${next}, stored ${row.balanceAfter}`);
    if (row.balanceAfter < 0) add("negative_balance", row.userId, `row ${row.id} left the balance at ${row.balanceAfter}`);
    running.set(row.userId, next);
  }
  for (const u of Object.values(state.users)) {
    const sum = running.get(u.id) ?? 0;
    if (Math.abs(sum - u.creditsBalance) > 0.005) add("balance_mismatch", u.id, `${u.username}: balance ${u.creditsBalance}, ledger ${sum}`);
    if (u.creditsBalance < 0) add("negative_balance", u.id, `${u.username}: ${u.creditsBalance}`);
  }

  // 2. Positions: no negative shares; closed positions hold nothing.
  for (const p of Object.values(state.positions)) {
    if (p.shares < -1e-9) add("negative_shares", p.id, `${p.shares} shares`);
    if (p.closedAt !== null && p.shares > 1e-9) add("closed_with_shares", p.id, `closed position still holds ${p.shares}`);
  }

  // 3. Market state reconstructs from trade history: q_i = Σ bought − Σ sold.
  const q = new Map<string, number>();
  for (const t of state.trades) q.set(t.outcomeId, (q.get(t.outcomeId) ?? 0) + (t.side === "BUY" ? t.shares : -t.shares));
  for (const [marketId, outcomes] of Object.entries(state.outcomes)) {
    for (const o of outcomes) {
      const expected = q.get(o.id) ?? 0;
      if (Math.abs(expected - o.quantity) > Math.max(1e-6, Math.abs(expected) * 1e-9)) {
        add("market_state", marketId, `${o.label}: stored q=${o.quantity.toFixed(6)}, replayed ${expected.toFixed(6)}`);
      }
    }
    const prices = outcomes.map((o) => o.currentPrice);
    const m = state.markets[marketId];
    if (m && m.status !== "SETTLED" && m.status !== "CANCELLED") {
      const sum = prices.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) add("price_sum", marketId, `prices sum to ${sum}`);
      if (prices.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) add("price_bounds", marketId, `prices ${prices.join(", ")}`);
    }
  }

  // 4. Settlement: at most one payout per user per market, payouts match the settlement record,
  //    and exactly one winning outcome.
  const payoutRows = new Map<string, number>();
  const payoutSum = new Map<string, number>();
  const refundRows = new Map<string, number>();
  for (const row of state.ledger) {
    if (row.type === "SETTLEMENT" && row.referenceId) {
      const k = `${row.userId}|${row.referenceId}`;
      payoutRows.set(k, (payoutRows.get(k) ?? 0) + 1);
      payoutSum.set(row.referenceId, cents((payoutSum.get(row.referenceId) ?? 0) + row.amount));
    }
    if (row.type === "CANCELLATION_REFUND" && row.referenceId) {
      const k = `${row.userId}|${row.referenceId}`;
      refundRows.set(k, (refundRows.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of payoutRows) if (n > 1) add("duplicate_settlement", k, `${n} payouts for one user in one market`);
  const positionsPerUserMarket = new Map<string, number>();
  for (const p of Object.values(state.positions)) {
    const k = `${p.userId}|${p.marketId}`;
    positionsPerUserMarket.set(k, (positionsPerUserMarket.get(k) ?? 0) + 1);
  }
  for (const [k, n] of refundRows) if (n > (positionsPerUserMarket.get(k) ?? 0)) add("duplicate_refund", k, `${n} refunds for ${positionsPerUserMarket.get(k) ?? 0} positions`);
  for (const s of Object.values(state.settlements)) {
    const m = state.markets[s.marketId];
    if (!m) {
      add("orphan_settlement", s.marketId, "settlement for a missing market");
      continue;
    }
    if (s.kind === "SETTLED") {
      const recorded = Number(s.metadata.payouts ?? 0);
      const paid = payoutSum.get(s.marketId) ?? 0;
      if (Math.abs(recorded - paid) > 0.01) add("payout_mismatch", s.marketId, `settlement says ${recorded}, ledger paid ${paid}`);
      if (m.status !== "SETTLED") add("status_mismatch", s.marketId, `settled but status ${m.status}`);
      const winners = (state.outcomes[s.marketId] ?? []).filter((o) => o.currentPrice === 1);
      if (winners.length !== 1 || winners[0].id !== s.winningOutcomeId) add("winner", s.marketId, `expected exactly one winner (${winners.length} found)`);
    } else if (m.status !== "CANCELLED") {
      add("status_mismatch", s.marketId, `cancelled but status ${m.status}`);
    }
  }
  const openByMarket = new Map<string, number>();
  for (const p of Object.values(state.positions)) if (p.shares > 1e-9) openByMarket.set(p.marketId, (openByMarket.get(p.marketId) ?? 0) + 1);
  for (const m of Object.values(state.markets)) {
    if ((m.status === "SETTLED" || m.status === "CANCELLED") && !state.settlements[m.id]) add("missing_settlement", m.id, `${m.status} without a settlement record`);
    const open = openByMarket.get(m.id) ?? 0;
    if ((m.status === "SETTLED" || m.status === "CANCELLED") && open) add("open_positions_after_close", m.id, `${open} positions still open`);
  }

  return {
    ok: issues.length === 0,
    checkedAt: now,
    users: Object.keys(state.users).length,
    markets: Object.keys(state.markets).length,
    ledgerRows: state.ledger.length,
    issues,
  };
}
