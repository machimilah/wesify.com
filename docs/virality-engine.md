# Virality engine

Code: `src/lib/virality-engine/index.ts`. Model version: `MODEL_VERSION` (stored with every forecast).

## Features (§19)

| Feature | How it's computed |
|---|---|
| Velocity | `(likes_now − likes_then) / minutes` over 5 min, 15 min, 30 min, 1 h, 3 h and 6 h, with linear interpolation between snapshots |
| Relative velocity | 5-minute velocity ÷ 1-hour velocity (>1 = accelerating right now) |
| Acceleration | velocity now − velocity one window ago, absolute and relative |
| Momentum score | weighted, log-normalized blend of velocities and accelerations in [0,1], smoothed (EWMA 0.3) so one reading can't flip it |
| Momentum labels | Cooling < 0.2 ≤ Stable < 0.4 ≤ Rising < 0.6 ≤ Surging < 0.8 ≤ Exploding |

## Forecast

The engine projects a decay-adjusted velocity to settlement. Growth is modelled as log-normal around that median. The spread (uncertainty) grows with the time remaining and with momentum. Range probabilities are CDF differences, normalized with a small floor, and ranges already exceeded are set to zero.

**Cold start (§19):** while a market has under an hour of trajectory, the forecast blends toward a prior. The prior is a wide log-normal centered on the creator baseline from the range formula, so "creator baseline if available" feeds pricing from minute one.

## Robustness

- `robustHistory` drops points that fall more than 20%, or spike and revert (a single noisy snapshot).
- Snapshots marked `suspicious` never reach the model (see "Metric collection" below).
- `isValidDistribution` guards the output; invalid output is never priced and raises an alert.

## Metric collection (§18)

| Rule | Behaviour |
|---|---|
| Normal interval | 5 minutes |
| Hot markets (momentum ≥ 0.6) | 2.5 minutes |
| Gaps | Backfilled step by step |
| Duplicates | Same or older timestamp is ignored |
| Unusual jump | Flagged |
| Impossible jump (>50k likes/min, or 10× with +10k) | Stored as suspicious, not priced, market paused for review |
| Drop over 20% | Suspicious. Accepted as a data correction once three consecutive readings agree within 5% |
| Freshness | Open markets pause after 20 minutes without a reading |
| Retention | Full resolution while live; hourly (plus every suspicious point) 24 h after settlement. Forecasts and price history are thinned the same way |

## Evaluation

- `npm run backtest` gives Brier score, log loss, bucket (top-range) accuracy and calibration bins at 1/3/6/12/18 h, compared with the naive linear-extrapolation baseline (`naiveLinearForecast`). `--sweep` searches parameters.
- `/admin` → Model applies the same measures to real settled markets from stored forecasts: calibration, accuracy by video age, creator size, momentum, during spikes, by model version, and weekly drift.
- Current synthetic result (3 runs × 8 scenarios): model Brier 0.43 vs naive 0.50; log loss 0.83 vs 1.38. Re-tune on real trajectories.
