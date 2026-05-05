"""
Rule 5 — Alt rotation logic. The ONLY rule that differs between v3 and v4.

Both functions have the same signature so the engine can swap them:

    def rule5(snapshot: dict, holding: str | None) -> tuple[str, float]:
        # snapshot is {"BTC": indicators_today, "ETH": ..., ...}
        # returns (target_asset, score_lead_over_btc)
        # The engine calls this only AFTER the regime gate has cleared.

The engine, not the rotation rule, decides whether to act on the signal.

NOTE: These implementations follow the spec doc verbatim. For full fidelity
to your live system, replace the body of each function with the actual code
extracted from bull_rotate_v3.py / bull_rotate_v4.py.
"""
from __future__ import annotations
import numpy as np


# ---------------------------------------------------------------------------
# v3.0 — composite momentum, +30 threshold
# ---------------------------------------------------------------------------

V3_THRESHOLD = 30.0


def score_v3(row: dict) -> float:
    """Score = 0.5*mom30 + 0.3*mom14 + 0.2*mom7  (percent units)"""
    m30 = row.get("mom_30", np.nan)
    m14 = row.get("mom_14", np.nan)
    m7  = row.get("mom_7",  np.nan)
    if any(np.isnan([m30, m14, m7])):
        return np.nan
    return 0.5 * m30 + 0.3 * m14 + 0.2 * m7


def rule5_v3(snapshot: dict, holding: str | None) -> tuple[str | None, float]:
    """
    Returns (best_alt, lead_over_btc). Caller fires rotation if lead >= V3_THRESHOLD.
    """
    btc_score = score_v3(snapshot["BTC"])
    if np.isnan(btc_score):
        return None, np.nan

    alt_scores = {a: score_v3(snapshot[a]) for a in snapshot if a != "BTC"}
    alt_scores = {a: s for a, s in alt_scores.items() if not np.isnan(s)}
    if not alt_scores:
        return None, np.nan

    best_alt = max(alt_scores, key=alt_scores.get)
    return best_alt, alt_scores[best_alt] - btc_score


# ---------------------------------------------------------------------------
# v4.0 — TFR composite (7 components), +1.5 threshold
# ---------------------------------------------------------------------------

V4_THRESHOLD = 1.5


def score_v4(row: dict) -> float:
    """
    7-component TFR Composite. Each component returns 0..1 except MSB which is
    -1, 0, or +1. Total range theoretically -1..7.

      1. RSI score         = clip((70 - rsi14) / 40, 0, 1)   — bullish below 50
      2. ATR/Price score   = ATR14/price percentile rank (60d)
      3. EMA50 trend       = 1.0 if close > ema50 else 0.0
      4. MSB signal        = +1 / 0 / -1
      5. Omega score       = clip((omega - 0.5) / 1.5, 0, 1)
      6. ROC14 percentile  = ROC14 percentile rank (60d)
      7. Volume conviction = up_vol / (up_vol + down_vol) over 14d
    """
    needed = ("rsi_14", "atr14_pct_pctile", "ema_50", "msb",
              "omega_30", "roc_14_pctile", "vol_conv_14", "close")
    if any(np.isnan(row.get(k, np.nan)) if k != "msb" else False for k in needed):
        # msb is int (0 if no warmup data), others must be valid
        if any(np.isnan(row.get(k, np.nan)) for k in needed if k != "msb"):
            return np.nan

    rsi_score = float(np.clip((70 - row["rsi_14"]) / 40, 0, 1))
    atr_score = float(row["atr14_pct_pctile"])
    ema_score = 1.0 if row["close"] > row["ema_50"] else 0.0
    msb_score = float(row["msb"])  # already -1 / 0 / +1
    omega_score = float(np.clip((row["omega_30"] - 0.5) / 1.5, 0, 1))
    roc_score = float(row["roc_14_pctile"])
    vol_score = float(row["vol_conv_14"])

    return rsi_score + atr_score + ema_score + msb_score + omega_score + roc_score + vol_score


def rule5_v4(snapshot: dict, holding: str | None) -> tuple[str | None, float]:
    btc_score = score_v4(snapshot["BTC"])
    if np.isnan(btc_score):
        return None, np.nan

    alt_scores = {a: score_v4(snapshot[a]) for a in snapshot if a != "BTC"}
    alt_scores = {a: s for a, s in alt_scores.items() if not np.isnan(s)}
    if not alt_scores:
        return None, np.nan

    best_alt = max(alt_scores, key=alt_scores.get)
    return best_alt, alt_scores[best_alt] - btc_score


# ---------------------------------------------------------------------------
# Strategy registry — what the engine reads
# ---------------------------------------------------------------------------

STRATEGIES = {
    "v3": {
        "name": "BULL_ROTATE v3.0 (Composite Momentum)",
        "rule5": rule5_v3,
        "threshold": V3_THRESHOLD,
        "score_fn": score_v3,
    },
    "v4": {
        "name": "BULL_ROTATE v4.0 (TFR Composite)",
        "rule5": rule5_v4,
        "threshold": V4_THRESHOLD,
        "score_fn": score_v4,
    },
}
