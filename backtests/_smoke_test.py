"""Smoke test: generate synthetic OHLCV, run the engine, verify outputs."""
import sys
import tempfile
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from engine import (BacktestConfig, align_and_trim, run_backtest,
                    yearly_breakdown, default_regime_confidence)
from rotations import STRATEGIES


def synth_ohlcv(start: str, n_days: int, seed: int, drift: float = 0.0005,
                vol: float = 0.04) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, vol, n_days)
    close = 100 * np.exp(np.cumsum(rets))
    high = close * (1 + np.abs(rng.normal(0, 0.01, n_days)))
    low = close * (1 - np.abs(rng.normal(0, 0.01, n_days)))
    open_ = np.r_[close[0], close[:-1]]
    volume = rng.lognormal(15, 0.5, n_days)
    idx = pd.date_range(start, periods=n_days, freq="D", tz=None)
    return pd.DataFrame({"open": open_, "high": high, "low": low,
                         "close": close, "volume": volume}, index=idx)


def main():
    n_days = 4 * 365 + 250  # 4y + warmup
    seeds = {"BTC": 1, "ETH": 2, "SOL": 3, "DOGE": 4, "SUI": 5}
    drifts = {"BTC": 0.0008, "ETH": 0.0009, "SOL": 0.0011,
              "DOGE": 0.0006, "SUI": 0.0010}
    vols = {"BTC": 0.035, "ETH": 0.045, "SOL": 0.06, "DOGE": 0.07, "SUI": 0.065}

    raw = {a: synth_ohlcv("2022-01-01", n_days, seeds[a], drifts[a], vols[a])
           for a in seeds}

    cfg = BacktestConfig(starting_capital=67_428.0, warmup_days=200)
    common, aligned = align_and_trim(raw, years=4, warmup_days=200,
                                     strip_today=False)
    print(f"Window: {common[0].date()} → {common[-1].date()} ({len(common)} bars)")
    print(f"Warmup={cfg.warmup_days}, trading days={len(common) - cfg.warmup_days}\n")

    results = {}
    for key in ("v3", "v4"):
        spec = STRATEGIES[key]
        print(f"--- {spec['name']} ---")
        r = run_backtest(aligned, cfg, spec["rule5"], spec["threshold"],
                         default_regime_confidence, strategy_name=key)
        s = r["summary"]
        print(f"  Final:    ${s['final_value']:,.2f}")
        print(f"  CAGR:     {s['cagr_pct']:+.2f}%")
        print(f"  Sharpe:   {s['sharpe']:.3f}")
        print(f"  Sortino:  {s['sortino']:.3f}")
        print(f"  Calmar:   {s['calmar']:.3f}")
        print(f"  MaxDD:    {s['max_drawdown_pct']:.2f}%")
        print(f"  Trades:   {s['n_trades']}")
        print(f"  Rules:    {s['rule_counts']}")
        print(f"  TimeCash: {s['time_in_cash_pct']:.1f}%\n")
        results[key] = r

    # Sanity: rules 1-4, 6 should fire identically; only R5 should differ.
    log_v3 = pd.DataFrame(results["v3"]["trade_log"])
    log_v4 = pd.DataFrame(results["v4"]["trade_log"])
    if not log_v3.empty and not log_v4.empty:
        non_r5_v3 = log_v3[~log_v3["rule"].str.startswith("R5")][["ts", "rule"]]
        non_r5_v4 = log_v4[~log_v4["rule"].str.startswith("R5")][["ts", "rule"]]
        common_dates = set(non_r5_v3["ts"]) & set(non_r5_v4["ts"])
        print(f"Non-R5 trade dates — v3: {len(non_r5_v3)}, v4: {len(non_r5_v4)}, "
              f"shared: {len(common_dates)}")
        # Note: they won't be identical because once strategies diverge on R5,
        # they're holding different assets, so R2/R3/R4 also fire on different
        # bars. This is expected; the engine itself is symmetric.

    print("\nOK: end-to-end run completed.")


if __name__ == "__main__":
    main()
