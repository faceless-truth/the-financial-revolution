#!/usr/bin/env python3
"""
Run BULL_ROTATE v3 vs v4 backtest over N years with full warmup.

Usage:
    python run_backtest.py --years 4 --warmup 200
    python run_backtest.py --data-dir /root/crypto_dashboard/data/ohlcv_full

Output: backtests/results/v3_vs_v4_<timestamp>/
    - summary.json           (metrics for both strategies, side-by-side)
    - v3_trades.csv          (full trade log)
    - v4_trades.csv
    - v3_equity.csv          (daily equity curve)
    - v4_equity.csv
    - v3_yearly.csv          (per-year breakdown)
    - v4_yearly.csv
    - daily_state_v3.csv     (per-day holding + rule fired)
    - daily_state_v4.csv
"""
from __future__ import annotations
import argparse
import json
from datetime import datetime
from pathlib import Path
import pandas as pd

from engine import (
    BacktestConfig, load_ohlcv, align_and_trim, run_backtest,
    yearly_breakdown, default_regime_confidence,
)
from rotations import STRATEGIES


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", type=Path,
                   default=Path("/root/crypto_dashboard/data/ohlcv_full"))
    p.add_argument("--out-dir", type=Path, default=Path("backtests/results"))
    p.add_argument("--years", type=int, default=4)
    p.add_argument("--warmup", type=int, default=200)
    p.add_argument("--starting-capital", type=float, default=67_428.0)
    p.add_argument("--fee-pct", type=float, default=0.004)
    p.add_argument("--strategies", nargs="+", default=["v3", "v4"],
                   choices=list(STRATEGIES.keys()))
    return p.parse_args()


def main():
    args = parse_args()

    cfg = BacktestConfig(
        starting_capital=args.starting_capital,
        fee_pct=args.fee_pct,
        warmup_days=args.warmup,
    )

    print(f"Loading OHLCV from {args.data_dir} ...")
    raw = load_ohlcv(args.data_dir, cfg.universe)
    for a, df in raw.items():
        print(f"  {a}: {len(df)} bars, {df.index[0].date()} → {df.index[-1].date()}")

    common, aligned = align_and_trim(raw, years=args.years,
                                     warmup_days=args.warmup, strip_today=True)
    print(f"\nCommon window: {common[0].date()} → {common[-1].date()} "
          f"({len(common)} bars; {args.warmup} warmup + ~{args.years}y trading)")

    if len(common) < args.warmup + 30:
        raise SystemExit(f"Not enough data: {len(common)} bars, need >= {args.warmup + 30}")

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_dir = args.out_dir / f"v3_vs_v4_{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nResults → {out_dir}")

    summaries = {}
    for key in args.strategies:
        spec = STRATEGIES[key]
        print(f"\n--- Running {spec['name']} ---")
        result = run_backtest(
            aligned=aligned,
            cfg=cfg,
            rule5_fn=spec["rule5"],
            rule5_threshold=spec["threshold"],
            regime_fn=default_regime_confidence,
            strategy_name=key,
        )

        # Trade log
        trades_path = out_dir / f"{key}_trades.csv"
        pd.DataFrame(result["trade_log"]).to_csv(trades_path, index=False)

        # Equity
        eq_path = out_dir / f"{key}_equity.csv"
        result["equity_curve"].to_csv(eq_path)

        # Daily state
        ds_path = out_dir / f"daily_state_{key}.csv"
        result["daily_state"].to_csv(ds_path)

        # Yearly breakdown
        yr = yearly_breakdown(result["equity_curve"])
        yr.to_csv(out_dir / f"{key}_yearly.csv", index=False)

        summaries[key] = result["summary"]
        print_summary(result["summary"])
        print(f"\n  Trades: {trades_path}")
        print(f"  Equity: {eq_path}")

    # Combined summary
    with open(out_dir / "summary.json", "w") as f:
        json.dump({
            "config": {
                "years": args.years,
                "warmup_days": args.warmup,
                "starting_capital": cfg.starting_capital,
                "fee_pct": cfg.fee_pct,
                "universe": list(cfg.universe),
                "data_window": {
                    "first_bar": common[0].isoformat(),
                    "last_bar": common[-1].isoformat(),
                    "n_bars": len(common),
                },
            },
            "strategies": summaries,
        }, f, indent=2, default=str)

    # Side-by-side print
    if len(summaries) >= 2:
        print("\n" + "=" * 64)
        print("HEAD-TO-HEAD")
        print("=" * 64)
        rows = []
        for key, s in summaries.items():
            rows.append({
                "strategy": key,
                "final": f"${s['final_value']:,.0f}",
                "CAGR%": f"{s['cagr_pct']:.2f}",
                "Sharpe": f"{s['sharpe']:.3f}",
                "Sortino": f"{s['sortino']:.3f}",
                "Calmar": f"{s['calmar']:.3f}",
                "MaxDD%": f"{s['max_drawdown_pct']:.2f}",
                "Trades": s["n_trades"],
                "Win%": f"{s['win_rate_pct']:.1f}",
                "Cash%": f"{s['time_in_cash_pct']:.1f}",
            })
        print(pd.DataFrame(rows).to_string(index=False))
        print()


def print_summary(s: dict):
    print(f"  Final value:      ${s['final_value']:,.2f}")
    print(f"  Total return:     {s['total_return_pct']:+.2f}%")
    print(f"  CAGR:             {s['cagr_pct']:+.2f}%")
    print(f"  Sharpe / Sortino: {s['sharpe']:.3f} / {s['sortino']:.3f}")
    print(f"  Calmar:           {s['calmar']:.3f}")
    print(f"  Max drawdown:     {s['max_drawdown_pct']:.2f}%")
    print(f"  Trades:           {s['n_trades']}  (win rate {s['win_rate_pct']:.1f}%)")
    print(f"  Time in cash:     {s['time_in_cash_pct']:.1f}%")
    print(f"  Rule counts:      {s['rule_counts']}")


if __name__ == "__main__":
    main()
