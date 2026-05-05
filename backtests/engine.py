"""
BULL_ROTATE Backtest Engine — shared rules + pluggable rotation.

Daily evaluation order (matches spec doc):
  Rule 1: BTC crash exit (overrides all)
  Rule 2: Per-position stop loss (-15% from entry)
  Rule 3: MSB structural exit (requires hold_days >= MIN_HOLD_DAYS)
  Rule 4: Regime exit (BTC mom30 < -0.2%)
  Rule 5: Alt rotation (pluggable, blocked by regime gate)
  Rule 6: Cash re-entry (only when holding == CASH)

Trade fee model: one fee per logical action (SELL, BUY, or ROTATE),
matching the spec's `proceeds = portfolio × 0.996` formulation.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import json
import numpy as np
import pandas as pd

from indicators import compute_asset_indicators


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class BacktestConfig:
    universe: tuple = ("BTC", "ETH", "SOL", "DOGE", "SUI")
    starting_capital: float = 67_428.0
    fee_pct: float = 0.004
    crash_threshold: float = -0.25            # Rule 1: -25% from 30d high
    stop_loss_pct: float = -0.15              # Rule 2: -15% from entry
    min_hold_days: int = 3                    # Rule 3 gate
    regime_exit_threshold: float = -0.002     # Rule 4: BTC mom30 < -0.2%
    regime_gate_pct: float = 0.65             # Rule 5 gate
    msb_wait_limit: int = 5                   # Rule 6 fallback
    profit_cashout_pct: float = 0.10
    warmup_days: int = 200


# ---------------------------------------------------------------------------
# Regime confidence — pluggable (provide your real implementation)
# ---------------------------------------------------------------------------

def default_regime_confidence(btc_row: dict) -> float:
    """
    PLACEHOLDER. Spec uses ADX, BB Width, Efficiency Ratio, Fractal Dimension,
    and Choppiness Index. This proxy uses choppiness + (1 - ADX/50) to keep
    the engine runnable. Replace with your live formula for fidelity.
    Returns 0..1; higher = choppier.
    """
    chop = btc_row.get("chop_14", np.nan)
    adx_v = btc_row.get("adx_14", np.nan)
    if np.isnan(chop) or np.isnan(adx_v):
        return np.nan
    chop_norm = float(np.clip(chop / 100.0, 0, 1))
    adx_inv = float(np.clip(1.0 - adx_v / 50.0, 0, 1))
    return 0.5 * chop_norm + 0.5 * adx_inv


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@dataclass
class State:
    holding: str = "CASH"
    entry_price: float = 0.0
    entry_date: pd.Timestamp | None = None
    hold_days: int = 0
    cash: float = 0.0       # cash on hand (only meaningful when holding == CASH)
    units: float = 0.0      # units of held asset
    reserve: float = 0.0    # accumulated profit cash-out
    msb_wait: int = 0


def equity(state: State, prices: dict) -> float:
    if state.holding == "CASH":
        return state.cash + state.reserve
    return state.units * prices[state.holding] + state.reserve


# ---------------------------------------------------------------------------
# Trade primitives — one fee per logical action
# ---------------------------------------------------------------------------

def _close(state: State, price: float, ts, fee: float,
           profit_cashout_pct: float, target_is_btc: bool) -> dict:
    gross = state.units * price
    proceeds = gross * (1 - fee)
    cost = state.units * state.entry_price
    pnl = proceeds - cost
    cashout = 0.0
    if target_is_btc and state.holding != "BTC" and pnl > 0:
        cashout = proceeds * profit_cashout_pct
        proceeds -= cashout
        state.reserve += cashout
    rec = {
        "from": state.holding, "close_price": price, "units": state.units,
        "gross": gross, "fee_paid": gross * fee, "pnl": pnl,
        "pnl_pct": pnl / cost if cost > 0 else 0.0,
        "cashout": cashout, "hold_days": state.hold_days,
    }
    state.holding = "CASH"
    state.cash = proceeds
    state.units = 0.0
    state.entry_price = 0.0
    state.entry_date = None
    state.hold_days = 0
    return rec


def _open(state: State, target: str, price: float, ts, fee: float) -> dict:
    proceeds = state.cash * (1 - fee)
    units = proceeds / price
    rec = {"to": target, "open_price": price, "units": units,
           "fee_paid": state.cash * fee}
    state.units = units
    state.holding = target
    state.entry_price = price
    state.entry_date = ts
    state.hold_days = 0
    state.cash = 0.0
    return rec


def sell_to_cash(state, price, ts, cfg) -> dict:
    return _close(state, price, ts, cfg.fee_pct, cfg.profit_cashout_pct,
                  target_is_btc=False)


def buy_from_cash(state, target, price, ts, cfg) -> dict:
    return _open(state, target, price, ts, cfg.fee_pct)


def rotate(state, target, sell_price, buy_price, ts, cfg) -> dict:
    """alt→BTC, BTC→alt, or alt→alt. One fee on the close; buy is feeless."""
    close_rec = _close(state, sell_price, ts, cfg.fee_pct,
                       cfg.profit_cashout_pct, target_is_btc=(target == "BTC"))
    open_rec = _open(state, target, buy_price, ts, fee=0.0)
    close_rec.update(open_rec)
    return close_rec


# ---------------------------------------------------------------------------
# Daily decision
# ---------------------------------------------------------------------------

def daily_step(state: State, ts, assets_today: dict, cfg: BacktestConfig,
               rule5_fn, rule5_threshold: float, regime_fn,
               trade_log: list) -> str | None:
    """
    Mutates state. Returns the rule that fired ('R1'..'R6') or None.
    `assets_today` is dict[asset_name] -> dict of indicator values for this bar.
    """
    btc = assets_today["BTC"]

    if state.holding != "CASH":
        state.hold_days += 1

    prices = {a: assets_today[a]["close"] for a in assets_today}

    def _log(rec, rule, **extra):
        rec.update({"ts": pd.Timestamp(ts).isoformat(), "rule": rule, **extra})
        trade_log.append(rec)

    # ---- Rule 1: BTC crash ----
    if not np.isnan(btc.get("dd_30d", np.nan)) and btc["dd_30d"] <= cfg.crash_threshold:
        if state.holding != "CASH":
            rec = sell_to_cash(state, prices[state.holding], ts, cfg)
            _log(rec, "R1_CRASH", btc_dd=btc["dd_30d"])
        return "R1"

    # ---- Rule 2: Stop loss ----
    if state.holding != "CASH":
        ret = prices[state.holding] / state.entry_price - 1
        if ret <= cfg.stop_loss_pct:
            if state.holding == "BTC":
                rec = sell_to_cash(state, prices["BTC"], ts, cfg)
                _log(rec, "R2_STOP_BTC", ret_from_entry=ret)
            else:
                rec = rotate(state, "BTC", prices[state.holding], prices["BTC"], ts, cfg)
                _log(rec, "R2_STOP_ALT_TO_BTC", ret_from_entry=ret)
            return "R2"

    # ---- Rule 3: MSB structural exit ----
    if state.holding != "CASH" and state.hold_days >= cfg.min_hold_days:
        if assets_today[state.holding].get("msb", 0) == -1:
            if state.holding == "BTC":
                rec = sell_to_cash(state, prices["BTC"], ts, cfg)
                _log(rec, "R3_MSB_BTC")
            else:
                rec = rotate(state, "BTC", prices[state.holding], prices["BTC"], ts, cfg)
                _log(rec, "R3_MSB_ALT_TO_BTC")
            return "R3"

    # ---- Rule 4: Regime exit ----
    if state.holding != "CASH":
        m30 = btc.get("mom_30", np.nan)
        if not np.isnan(m30) and (m30 / 100.0) < cfg.regime_exit_threshold:
            rec = sell_to_cash(state, prices[state.holding], ts, cfg)
            _log(rec, "R4_REGIME_EXIT", btc_mom30_pct=m30)
            return "R4"

    # ---- Rule 5: Alt rotation ----
    if state.holding != "CASH":
        rconf = regime_fn(btc)
        if not np.isnan(rconf) and rconf < cfg.regime_gate_pct:
            best_alt, lead = rule5_fn(assets_today, state.holding)
            if best_alt and not np.isnan(lead) and lead >= rule5_threshold \
                    and best_alt != state.holding:
                rec = rotate(state, best_alt, prices[state.holding],
                             prices[best_alt], ts, cfg)
                _log(rec, "R5_ROTATE", lead=lead, regime_conf=rconf, target=best_alt)
                return "R5"

    # ---- Rule 6: Cash re-entry ----
    if state.holding == "CASH":
        m30 = btc.get("mom_30", np.nan)
        if np.isnan(m30) or m30 <= 0:
            state.msb_wait = 0
            return None
        state.msb_wait += 1

        if btc.get("msb", 0) == 1:
            rec = buy_from_cash(state, "BTC", prices["BTC"], ts, cfg)
            _log(rec, "R6_BTC_MSB_ENTRY")
            state.msb_wait = 0
            return "R6"

        eth = assets_today.get("ETH")
        if eth is not None and eth.get("msb", 0) == 1:
            rconf = regime_fn(btc)
            if not np.isnan(rconf) and rconf >= cfg.regime_gate_pct:
                rec = buy_from_cash(state, "ETH", prices["ETH"], ts, cfg)
                _log(rec, "R6_ETH_MSB_ENTRY", regime_conf=rconf)
                state.msb_wait = 0
                return "R6"

        if state.msb_wait >= cfg.msb_wait_limit:
            rec = buy_from_cash(state, "BTC", prices["BTC"], ts, cfg)
            _log(rec, "R6_FALLBACK_BTC")
            state.msb_wait = 0
            return "R6"

    return None


# ---------------------------------------------------------------------------
# Simulator
# ---------------------------------------------------------------------------

def load_ohlcv(data_dir: Path, universe: tuple,
               filename_pattern: str = "{coin}USDT_1d.csv") -> dict:
    """
    Read each asset's OHLCV CSV from data_dir. Expected columns include
    open, high, low, close, volume, plus a date/time column (auto-detected).
    Returns dict[asset] -> DataFrame with DatetimeIndex.
    """
    out = {}
    for coin in universe:
        path = data_dir / filename_pattern.format(coin=coin)
        df = pd.read_csv(path)
        df.columns = [c.strip().lower() for c in df.columns]
        # Find a time column
        for cand in ("timestamp", "date", "time", "open_time"):
            if cand in df.columns:
                df["__ts"] = pd.to_datetime(df[cand], utc=True, errors="coerce")
                break
        else:
            raise ValueError(f"No time column found in {path}")
        df = df.dropna(subset=["__ts"]).set_index("__ts").sort_index()
        df.index = df.index.tz_localize(None) if df.index.tz else df.index
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        out[coin] = df
    return out


def align_and_trim(data: dict, years: int, warmup_days: int,
                   strip_today: bool = True) -> tuple[pd.DatetimeIndex, dict]:
    """
    Intersect all asset indices, drop today's incomplete bar, trim to
    (years * 365 + warmup_days) most recent bars.
    """
    common = None
    for df in data.values():
        common = df.index if common is None else common.intersection(df.index)
    if strip_today:
        today = pd.Timestamp.utcnow().normalize().tz_localize(None)
        common = common[common < today]
    needed = years * 365 + warmup_days
    common = common[-needed:]
    aligned = {a: df.loc[common].copy() for a, df in data.items()}
    return common, aligned


def run_backtest(aligned: dict, cfg: BacktestConfig, rule5_fn,
                 rule5_threshold: float, regime_fn=default_regime_confidence,
                 strategy_name: str = "strategy") -> dict:
    """
    Returns {trade_log, equity_curve, summary, daily_state}.
    """
    # Pre-compute indicators per asset
    enriched = {a: compute_asset_indicators(df) for a, df in aligned.items()}
    idx = next(iter(enriched.values())).index

    state = State(holding="CASH", cash=cfg.starting_capital)
    trade_log: list[dict] = []
    equity_curve = []
    daily_state = []

    start_idx = cfg.warmup_days
    for i in range(start_idx, len(idx)):
        ts = idx[i]
        assets_today = {a: enriched[a].iloc[i].to_dict() for a in enriched}
        rule = daily_step(state, ts, assets_today, cfg,
                          rule5_fn, rule5_threshold, regime_fn, trade_log)
        prices = {a: assets_today[a]["close"] for a in assets_today}
        eq = equity(state, prices)
        equity_curve.append({"ts": ts, "equity": eq, "holding": state.holding})
        daily_state.append({
            "ts": ts, "holding": state.holding, "hold_days": state.hold_days,
            "equity": eq, "rule_fired": rule,
        })

    eq_df = pd.DataFrame(equity_curve).set_index("ts")
    summary = compute_metrics(eq_df, trade_log, cfg, strategy_name)
    return {
        "strategy": strategy_name,
        "trade_log": trade_log,
        "equity_curve": eq_df,
        "summary": summary,
        "daily_state": pd.DataFrame(daily_state).set_index("ts"),
    }


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def compute_metrics(eq_df: pd.DataFrame, trades: list, cfg: BacktestConfig,
                    name: str) -> dict:
    eq = eq_df["equity"]
    n_days = len(eq)
    years = n_days / 365.25
    final = float(eq.iloc[-1])
    cagr = (final / cfg.starting_capital) ** (1 / years) - 1 if years > 0 else 0.0

    daily_ret = eq.pct_change().dropna()
    sharpe = float(daily_ret.mean() / daily_ret.std() * np.sqrt(365)) if daily_ret.std() > 0 else 0.0
    downside = daily_ret[daily_ret < 0]
    sortino = float(daily_ret.mean() / downside.std() * np.sqrt(365)) if len(downside) > 1 and downside.std() > 0 else 0.0

    running_max = eq.cummax()
    dd = eq / running_max - 1
    max_dd = float(dd.min())
    calmar = cagr / abs(max_dd) if max_dd < 0 else 0.0

    rule_counts = {}
    for t in trades:
        rule_counts[t.get("rule", "?")] = rule_counts.get(t.get("rule", "?"), 0) + 1

    pnl_trades = [t for t in trades if "pnl" in t]
    wins = [t for t in pnl_trades if t["pnl"] > 0]
    losses = [t for t in pnl_trades if t["pnl"] <= 0]
    win_rate = len(wins) / len(pnl_trades) if pnl_trades else 0.0

    time_in_cash = (eq_df["holding"] == "CASH").sum() / len(eq_df) if len(eq_df) else 0.0

    return {
        "strategy": name,
        "start": eq_df.index[0].isoformat() if len(eq_df) else None,
        "end": eq_df.index[-1].isoformat() if len(eq_df) else None,
        "days": int(n_days),
        "starting_capital": cfg.starting_capital,
        "final_value": final,
        "total_return_pct": (final / cfg.starting_capital - 1) * 100,
        "cagr_pct": cagr * 100,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "max_drawdown_pct": max_dd * 100,
        "n_trades": len(trades),
        "win_rate_pct": win_rate * 100,
        "rule_counts": rule_counts,
        "time_in_cash_pct": time_in_cash * 100,
        "n_wins": len(wins),
        "n_losses": len(losses),
    }


def yearly_breakdown(eq_df: pd.DataFrame) -> pd.DataFrame:
    yr = eq_df["equity"].resample("YE").last()
    yr0 = eq_df["equity"].resample("YE").first()
    out = pd.DataFrame({
        "year": yr.index.year,
        "start_equity": yr0.values,
        "end_equity": yr.values,
        "return_pct": (yr.values / yr0.values - 1) * 100,
    })
    return out
