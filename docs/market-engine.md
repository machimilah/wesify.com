# Market engine

## Mechanism: LMSR with a model prior (§20, §21)

```
effective_logit_i = ln(model_probability_i) + q_i / b
C(q)  = b · ln Σ exp(effective_logit_i)
p_i   = softmax(effective_logits)_i
```

- `q_i` is the outstanding shares of outcome *i* (user trades change it).
- `model_probability_i` is the virality model's prior (real engagement changes it).
- `b` is liquidity. Default 2,500, chosen so a max-size trade (W$2,000) moves a price meaningfully without deciding the market. Admins can change it only before the first trade, because rescaling afterwards would break state reconstruction.

**Buy, sell and slippage.** Buy and sell prices come from the closed forms in `lmsr.ts` (`sharesForCredits`, `proceedsForShares`). The quote module gives the same numbers to the browser from price and `b` alone. Slippage is the gap between the current price and the average fill; the ticket shows it as "Price impact".

**Round trips don't create money.** Buying then selling at an unchanged prior is cost-neutral, and proceeds are floored to the cent. Tests assert that loops never create W$.

## How real engagement moves prices (§21)

- Model and trading state are separate: `modelProbability` lives on outcomes, trades only change `quantity`.
- Each repricing smooths the new forecast into the old prior (EWMA, alpha 0.2, or 0.35 during spikes). Ranges that are already impossible are pinned to the floor.
- **Maximum movement per update:** a single repricing may move any price at most **15 points** (30 during a spike). The engine blends the prior log-linearly and binary-searches the largest step that stays within the cap. Unreachable ranges are exempt, because reality beats the cap. Capped updates are marked in the forecast log.
- **Model weight vs traders:** the prior's influence is `ln(p_model)`, and traders move `q/b`. As trading grows, `q/b` dominates, so model influence falls with liquidity by construction.
- **Invalid output is never priced.** Invalid means NaN, anything outside [0,1], or probabilities not summing to 1. The previous prior stays, a critical alert fires, and the market is flagged.
- **Every repricing is logged** in `state.forecasts`: model version, expected final likes, uncertainty, momentum, probabilities, prices before and after, capped flag. The admin market detail explains large repricings (8 points or more).
- **Emergency pause:** pause one market, pause all markets, or the global trading kill switch.

## Safety bounds (§8, §20, §27)

| Bound | Value |
|---|---|
| Minimum trade | W$1 |
| Max per trade | 20% of cash |
| Max in one market | 50% of portfolio, at cost basis |
| Max price after a buy | 99% |
| Max potential payout per outcome per user | W$25,000 |
| Max trades per user per hour | 60 |
| Price tolerance between review and fill | 3 points (client can tighten) |

Negative shares, negative balances and oversells are rejected before any state changes.

## Market state

The state persists with every change and is reconstructible: `q_i = Σ bought − Σ sold` from the trade history (checked by `checkIntegrity`). Price history is appended on every price change and thinned to hourly once the market is 24 hours past settlement. Trade history is never deleted.

## Tests

`tests/unit/lmsr.test.ts`, `trading.test.ts`, `trading-safety.test.ts`; simulations in `tests/integration/simulations.test.ts` (low liquidity, extreme one-sided markets, 300 simultaneous users, high volume).

**Staging reset:** the admin "Reset" action refunds everyone and re-creates a simulated market. It is refused when `APP_ENV=production`.
