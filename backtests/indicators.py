"""
Indicators for BULL_ROTATE v3 vs v4 backtester.

Every function takes pandas Series and returns a Series aligned to the
input index. NaN during warmup is preserved — never filled, never dropped.

Warmup table (for budgeting how much pre-trade data we need):

  Indicator                            | Bars needed before first valid value
  -------------------------------------+--------------------------------------
  RSI(14)                              | 14
  ATR(14)                              | 14
  ATR(14) percentile over 60d          | 14 + 60 = 74
  EMA(50)  [first valid]               | 50
  EMA(50)  [stable / converged]        | ~150  (3x span, recommended)
  MSB pivots(5/5) + 60-bar lookback    | ~70   (pivots need both sides + window)
  Omega ratio(30)                      | 30
  ROC(14) percentile over 60d          | 14 + 60 = 74
  Volume conviction(14)                | 14
  Momentum 30 / 14 / 7                 | 30 / 14 / 7
  30d high (Rule 1 crash)              | 30
  Choppiness(14), ADX(14)              | 14
  ATR(5)  [for MSB buffer]             | 5

Practical warmup: 200 bars covers EMA(50) convergence with margin and
all percentile/lookback windows. Use 200 in the runner.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Core indicators
# ---------------------------------------------------------------------------

def rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_g = gain.ewm(alpha=1 / length, adjust=False).mean()
    avg_l = loss.ewm(alpha=1 / length, adjust=False).mean()
    rs = avg_g / avg_l.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(avg_l > 0, 100.0).where(avg_g > 0, out)


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    return pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    return true_range(high, low, close).ewm(alpha=1 / length, adjust=False).mean()


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False).mean()


def momentum_pct(close: pd.Series, length: int) -> pd.Series:
    """Pct return over `length` bars, expressed as percent (e.g. 17.33 for +17.33%)."""
    return (close / close.shift(length) - 1) * 100


def drawdown_from_high(close: pd.Series, length: int = 30) -> pd.Series:
    """Pct distance below rolling N-day high (negative or zero)."""
    hi = close.rolling(length).max()
    return (close - hi) / hi


def percentile_rank(series: pd.Series, length: int = 60) -> pd.Series:
    """Rolling percentile rank of current value within last `length` bars (0–1).
    A value of 1.0 means current is the highest in the window."""
    def pct(x):
        last = x[-1]
        if np.isnan(last):
            return np.nan
        return float((x <= last).sum()) / len(x)
    return series.rolling(length).apply(pct, raw=True)


def omega_ratio(close: pd.Series, length: int = 30, threshold: float = 0.0) -> pd.Series:
    """Rolling Omega: sum(gains>thr) / sum(losses<thr) over `length` daily returns."""
    r = close.pct_change()
    gains = (r - threshold).clip(lower=0)
    losses = (threshold - r).clip(lower=0)
    sg = gains.rolling(length).sum()
    sl = losses.rolling(length).sum()
    return sg / sl.replace(0, np.nan)


def volume_conviction(close: pd.Series, volume: pd.Series, length: int = 14) -> pd.Series:
    """avg(up-day volume) / [avg(up-day vol) + avg(down-day vol)] over `length`."""
    delta = close.diff()
    up = volume.where(delta > 0, 0.0)
    dn = volume.where(delta < 0, 0.0)
    su = up.rolling(length).mean()
    sd = dn.rolling(length).mean()
    tot = su + sd
    return su / tot.replace(0, np.nan)


def choppiness_index(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    tr = true_range(high, low, close)
    s = tr.rolling(length).sum()
    rng = (high.rolling(length).max() - low.rolling(length).min()).replace(0, np.nan)
    return 100 * np.log10(s / rng) / np.log10(length)


def adx(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    up = high.diff()
    dn = -low.diff()
    plus_dm = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=high.index)
    a = atr(high, low, close, length)
    pdi = 100 * plus_dm.ewm(alpha=1 / length, adjust=False).mean() / a
    mdi = 100 * minus_dm.ewm(alpha=1 / length, adjust=False).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / length, adjust=False).mean()


# ---------------------------------------------------------------------------
# MSB (Market Structure Break)
#   Pivots: 5 bars confirm on each side. A pivot at center bar c is reported
#   on bar c+right (when right window completes). MSB fires when close crosses
#   the most recent confirmed pivot ± (atr_buffer_mult * 5d ATR).
# ---------------------------------------------------------------------------

def find_pivots(high: pd.Series, low: pd.Series,
                left: int = 5, right: int = 5) -> tuple[pd.Series, pd.Series]:
    n = len(high)
    ph = pd.Series(np.nan, index=high.index)
    pl = pd.Series(np.nan, index=low.index)
    h_arr = high.to_numpy()
    l_arr = low.to_numpy()
    for i in range(left + right, n):
        c = i - right
        h_win = h_arr[c - left:c + right + 1]
        l_win = l_arr[c - left:c + right + 1]
        if h_arr[c] == h_win.max() and np.sum(h_win == h_arr[c]) == 1:
            ph.iloc[i] = h_arr[c]
        if l_arr[c] == l_win.min() and np.sum(l_win == l_arr[c]) == 1:
            pl.iloc[i] = l_arr[c]
    return ph, pl


def msb_signals(high: pd.Series, low: pd.Series, close: pd.Series,
                atr5: pd.Series, left: int = 5, right: int = 5,
                lookback: int = 60, atr_mult: float = 1.0) -> pd.Series:
    """+1 = bullish break, -1 = bearish break, 0 = no signal.
    Bullish takes precedence if both fire on the same bar."""
    ph, pl = find_pivots(high, low, left, right)
    sig = pd.Series(0, index=close.index, dtype=int)

    last_ph = np.nan
    last_pl = np.nan
    ph_age = lookback + 1
    pl_age = lookback + 1

    for i in range(len(close)):
        # update most-recent confirmed pivots within lookback
        if not np.isnan(ph.iloc[i]):
            last_ph = ph.iloc[i]
            ph_age = 0
        else:
            ph_age += 1
        if not np.isnan(pl.iloc[i]):
            last_pl = pl.iloc[i]
            pl_age = 0
        else:
            pl_age += 1

        a = atr5.iloc[i]
        if np.isnan(a):
            continue
        buf = a * atr_mult
        c = close.iloc[i]

        if not np.isnan(last_ph) and ph_age <= lookback and c > last_ph + buf:
            sig.iloc[i] = 1
        elif not np.isnan(last_pl) and pl_age <= lookback and c < last_pl - buf:
            sig.iloc[i] = -1
    return sig


# ---------------------------------------------------------------------------
# Pre-compute everything an asset needs, once.
# ---------------------------------------------------------------------------

def compute_asset_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Input df must have columns: open, high, low, close, volume (lowercase).
    Returns df with all derived columns added. NaN warmup preserved.
    """
    out = df.copy()
    h, l, c, v = out["high"], out["low"], out["close"], out["volume"]

    # Momentum (Rule 1, 4, 5_v3, re-entry)
    out["mom_30"] = momentum_pct(c, 30)
    out["mom_14"] = momentum_pct(c, 14)
    out["mom_7"] = momentum_pct(c, 7)

    # 30d drawdown for crash check
    out["dd_30d"] = drawdown_from_high(c, 30)

    # ATR(14) for TFR ATR component, and ATR(5) for MSB buffer
    out["atr_14"] = atr(h, l, c, 14)
    out["atr_5"] = atr(h, l, c, 5)
    out["atr14_pct_pctile"] = percentile_rank(out["atr_14"] / c, 60)

    # TFR components
    out["rsi_14"] = rsi(c, 14)
    out["ema_50"] = ema(c, 50)
    out["roc_14"] = c.pct_change(14) * 100
    out["roc_14_pctile"] = percentile_rank(out["roc_14"], 60)
    out["omega_30"] = omega_ratio(c, 30, 0.0)
    out["vol_conv_14"] = volume_conviction(c, v, 14)

    # Regime ingredients (the actual confidence formula is yours; expose components)
    out["chop_14"] = choppiness_index(h, l, c, 14)
    out["adx_14"] = adx(h, l, c, 14)

    # MSB
    out["msb"] = msb_signals(h, l, c, out["atr_5"],
                             left=5, right=5, lookback=60, atr_mult=1.0)

    return out
