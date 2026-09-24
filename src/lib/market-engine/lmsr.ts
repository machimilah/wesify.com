/**
 * LMSR with a model prior (spec §21–22).
 *
 *   effective_logit_i = ln(model_probability_i) + q_i / b
 *   C(q)  = b · ln Σ exp(effective_logit_i)
 *   p_i   = softmax(effective_logits)_i = ∂C/∂q_i
 *
 * Model updates change the prior; user trades change q. Because prices are the
 * gradient of C, buying and immediately selling the same shares is always
 * cost-neutral while the prior is unchanged.
 */

export type LmsrState = {
  b: number;
  quantities: number[];
  modelProbabilities: number[];
};

function logSumExp(xs: number[]): number {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((acc, x) => acc + Math.exp(x - m), 0));
}

export function effectiveLogits(s: LmsrState): number[] {
  return s.quantities.map((q, i) => Math.log(s.modelProbabilities[i]) + q / s.b);
}

export function prices(s: LmsrState): number[] {
  const logits = effectiveLogits(s);
  const lse = logSumExp(logits);
  return logits.map((l) => Math.exp(l - lse));
}

export function cost(s: LmsrState): number {
  return s.b * logSumExp(effectiveLogits(s));
}

/** Shares received for spending `credits` on outcome i: Δ = b·ln(1 + (e^{x/b} − 1)/p_i). */
export function sharesForCredits(s: LmsrState, i: number, credits: number): number {
  if (credits <= 0) return 0;
  const p = prices(s)[i];
  return s.b * Math.log1p(Math.expm1(credits / s.b) / p);
}

/** Credits required to buy `shares` of outcome i: x = b·ln(1 − p_i + p_i·e^{Δ/b}). */
export function creditsForShares(s: LmsrState, i: number, shares: number): number {
  if (shares <= 0) return 0;
  const p = prices(s)[i];
  return s.b * Math.log1p(p * Math.expm1(shares / s.b));
}

/** Credits received for selling `shares` of outcome i: x = −b·ln(1 − p_i(1 − e^{−Δ/b})). */
export function proceedsForShares(s: LmsrState, i: number, shares: number): number {
  if (shares <= 0) return 0;
  const p = prices(s)[i];
  const oneMinusDecay = -Math.expm1(-shares / s.b); // 1 − e^{−Δ/b}
  return -s.b * Math.log1p(-p * oneMinusDecay);
}

export function withQuantityDelta(s: LmsrState, i: number, delta: number): LmsrState {
  return { ...s, quantities: s.quantities.map((q, j) => (j === i ? q + delta : q)) };
}

export function withModel(s: LmsrState, modelProbabilities: number[]): LmsrState {
  return { ...s, modelProbabilities };
}
