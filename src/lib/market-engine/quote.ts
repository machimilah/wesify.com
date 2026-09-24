/**
 * Client-safe quotes. For LMSR a fill depends only on the outcome's current price and b,
 * so the trade sheet can show exact estimates without the full market state.
 */
export function quoteBuyShares(price: number, b: number, credits: number): number {
  if (!(credits > 0) || !(price > 0)) return 0;
  return b * Math.log1p(Math.expm1(credits / b) / price);
}

export function quoteSellProceeds(price: number, b: number, shares: number): number {
  if (!(shares > 0)) return 0;
  return -b * Math.log1p(-price * -Math.expm1(-shares / b));
}

export function priceAfterBuy(price: number, b: number, shares: number): number {
  const grown = price * Math.exp(shares / b);
  return grown / (1 - price + grown);
}
