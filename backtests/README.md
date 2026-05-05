# BULL_ROTATE Backtester — v3 vs v4

A single engine, identical Rules 1/2/3/4/6, swappable Rule 5. Any performance
delta between the two runs is attributable to the rotation rule alone.

## Files

| File | Purpose |
|---|---|
| `indicators.py` | All indicator math + warmup table (RSI, ATR, EMA, MSB pivots, Omega, ROC pctile, volume conviction, choppiness, ADX, momentum). |
| `rotations.py`  | `rule5_v3` (composite momentum, +30 threshold) and `rule5_v4` (TFR composite, +1.5 threshold). One function each — replace bodies with code from your live scripts for full fidelity. |
| `engine.py`     | State, shared rules, trade primitives (one fee per logical action), simulator, metrics. |
| `run_backtest.py` | CLI entry point. |

## Warmup

Longest indicator dependency is **EMA(50)** convergence (~3× span ≈ 150 bars).
ATR/ROC percentile-rank windows need 14 + 60 = 74 bars. MSB needs ~70. Default
warmup is **200 bars**, which covers all of them with margin and means no live
trading happens before every indicator is fully valid for every asset.

For a 4-year backtest you need **4 × 365 + 200 ≈ 1660 bars** of common-index
OHLCV across all 5 assets. The runner intersects each asset's date index, drops
today's incomplete bar, and trims to the last `years * 365 + warmup` rows.

## Run it

```bash
cd /root/crypto_dashboard
python3 backtests/run_backtest.py --years 4 --warmup 200
```

Outputs go to `backtests/results/v3_vs_v4_<UTC timestamp>/`:
- `summary.json` — head-to-head metrics
- `v3_trades.csv` / `v4_trades.csv` — full trade log with rule fired
- `v3_equity.csv` / `v4_equity.csv` — daily equity curve
- `daily_state_v3.csv` / `daily_state_v4.csv` — per-day holding + rule fired
- `v3_yearly.csv` / `v4_yearly.csv` — per-year return breakdown

To compare trade logs:
```bash
diff <(awk -F, '{print $1,$2}' v3_trades.csv) \
     <(awk -F, '{print $1,$2}' v4_trades.csv)
```
Any divergence on a non-Rule-5 day is an engine bug, not a strategy difference.

## Four hooks to validate against your live code

The scaffold follows the spec doc verbatim, but four pieces should be
cross-checked against `bull_rotate_v3.py` / `bull_rotate_v4.py`:

1. **`rotations.score_v3` / `score_v4`** — exact formulae for the rotation
   metric. The TFR weights, clipping, and component definitions in the spec
   match what you described, but if your live script has any tweaks (e.g.,
   different RSI normalization range, different ATR percentile window),
   transplant that code directly.

2. **`engine.default_regime_confidence`** — placeholder using choppiness + ADX.
   The spec says the live formula uses ADX, BB Width, Efficiency Ratio,
   Fractal Dimension Index, and Choppiness Index. Replace this function with
   your real one before relying on the results.

3. **`indicators.msb_signals`** — implements 5-bar pivots / 60-bar lookback /
   1× ATR(5) buffer per the spec. If your live MSB has a different ATR
   multiplier, lookback, or signal-suppression logic (e.g. one signal per
   pivot break), match it here.

4. **Trade fee model** — one fee per logical action (`SELL`, `BUY`, `ROTATE`),
   matching the spec's `proceeds = portfolio × 0.996` formulation. If the live
   system charges fee on both sides of a rotation (which is more realistic),
   change `_open` to take `fee=cfg.fee_pct` inside `rotate()`.

## Things to sanity-check before trusting results

- **Run with `--years 1` first** to verify the engine runs end-to-end on a
  small window, then scale up to 4.
- **Compare daily holding state to your live script's recent decisions** —
  if you have a few months of live trade history, run the backtest over that
  same window and confirm the engine reproduces the live trades.
- **Watch for Rule 4 (regime exit) dominating the trade count.** Per your
  3-year backtest, this fires 53× over 3 years and 54.7% of those exits are
  false signals. To isolate the v3-vs-v4 Rule-5 effect from Rule-4 noise,
  also run with a relaxed regime threshold:

  ```python
  cfg = BacktestConfig(regime_exit_threshold=-0.05)  # was -0.002
  ```

- **Min hold of 3 days creates whipsaw on MSB entries** (per your own notes).
  Try `min_hold_days=7` as a v4.1 variant — same Rule 5, better hold gate.

## Extending

Add a new strategy by registering in `rotations.STRATEGIES`:

```python
def rule5_v41(snapshot, holding):
    # your variant...
    return best_alt, lead

STRATEGIES["v41"] = {
    "name": "BULL_ROTATE v4.1",
    "rule5": rule5_v41,
    "threshold": 2.0,
    "score_fn": score_v41,
}
```

Then: `python3 run_backtest.py --strategies v3 v4 v41`
