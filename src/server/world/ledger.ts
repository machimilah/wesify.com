import { newId } from "@/lib/shared/random";
import type { LedgerType } from "@/lib/shared/types";
import type { Ctx } from "./context";

export const roundCents = (n: number) => Math.round(n * 100) / 100;
export const floorCents = (n: number) => Math.floor(n * 100 + 1e-9) / 100;

const DEFAULT_DESCRIPTIONS: Record<LedgerType, string> = {
  WELCOME_BONUS: "Welcome credits",
  BUY: "Bought shares",
  SELL: "Sold shares",
  SETTLEMENT: "Market payout",
  CANCELLATION_REFUND: "Refund for a cancelled market",
  ADMIN_ADJUSTMENT: "Balance adjustment by Wesify",
  ADMIN_REFUND: "Refund issued by Wesify support",
  REFERRAL: "Referral reward",
};

/**
 * The only way a balance changes (§35). Appends a ledger row with the resulting balance.
 * Callers must have validated the operation; this throws rather than allowing a negative balance.
 */
export function postLedger(
  ctx: Ctx,
  input: {
    userId: string;
    type: LedgerType;
    amount: number;
    referenceType?: string;
    referenceId?: string;
    description?: string;
  },
) {
  const user = ctx.state.users[input.userId];
  if (!user) throw new Error(`ledger: unknown user ${input.userId}`);
  const amount = roundCents(input.amount);
  if (!Number.isFinite(amount)) throw new Error("ledger: amount must be finite");
  const balanceAfter = roundCents(user.creditsBalance + amount);
  if (balanceAfter < 0) throw new Error("ledger: balance would go negative");
  const now = ctx.now();
  user.creditsBalance = balanceAfter;
  user.updatedAt = now;
  const row = {
    id: newId("led"),
    userId: user.id,
    type: input.type,
    amount,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    balanceAfter,
    createdAt: now,
    description: input.description ?? DEFAULT_DESCRIPTIONS[input.type],
  };
  ctx.state.ledger.push(row);
  return row;
}

/** Recomputes a balance from the ledger; used by integrity checks and tests. */
export function ledgerBalance(ctx: Ctx, userId: string): number {
  return roundCents(
    ctx.state.ledger.filter((l) => l.userId === userId).reduce((sum, l) => sum + l.amount, 0),
  );
}

export function describeLedger(type: LedgerType) {
  return DEFAULT_DESCRIPTIONS[type];
}
