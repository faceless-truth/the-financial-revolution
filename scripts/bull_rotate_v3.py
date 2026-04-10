#!/usr/bin/env python3
"""
BULL_ROTATE v3.0 — Hybrid (Momentum Regime + MSB Structural Exits + Alt Rotation)
───────────────────────────────────────────────────────────────────────────────────
Combines the best of BULL_ROTATE v2.0 and MSB Breakout strategy:

ENTRY:
  - Regime gate: Only enter when BTC 30d momentum > 0 (bull market confirmed)
  - Prefer MSB bullish breakout (price breaks above recent pivot high + ATR buffer)
  - Fallback: if regime is bullish but no MSB fires within 5 days, enter BTC anyway

EXIT (upgraded from v2.0):
  - MSB structural exit: exit immediately when price breaks below recent pivot low
  - Regime exit: BTC 30d momentum turns negative (hold >= 3 days)
  - Crash exit: BTC 30d drawdown <= -25% (hard backstop)
  - Stop loss: -15% from entry price

ROTATION:
  - Composite score rotation into best alt (30pp lead over BTC, 3-day min hold)
  - Alt -> BTC if BTC leads alt by 30pp or regime turns negative
  - Profit cash-out: 10% on profitable alt -> BTC rotations

MSB SIGNALS:
  - Writes msb_signals.json alongside state file for dashboard MSB panel
  - Tracks all pivot highs/lows, current breakout/breakdown status for all assets

Universe: BTC, ETH (v3.0 focused — expand as needed)
Runs daily at 00:05 UTC after Binance daily close
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import json
import logging
import requests
import warnings

warnings.filterwarnings('ignore')

# ══════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════

DASHBOARD_ROOT      = os.environ.get("CRYPTO_DASHBOARD_ROOT", "/root/crypto_dashboard")
STATE_FILE          = os.path.join(DASHBOARD_ROOT, "bull_rotate_state.json")
HISTORY_FILE        = os.path.join(DASHBOARD_ROOT, "bull_rotate_history.json")
MSB_FILE            = os.path.join(DASHBOARD_ROOT, "msb_signals.json")
LOG_FILE            = os.path.join(DASHBOARD_ROOT, "bull_rotate.log")

BINANCE_API_URL     = "https://api.binance.com/api/v3/klines"

ASSETS              = ['BTC', 'ETH', 'SOL', 'DOGE', 'SUI']
SCORE_WEIGHTS       = (0.5, 0.3, 0.2)   # 30d, 14d, 7d
ROTATION_THRESHOLD  = 30.0
STOP_LOSS_PCT       = 0.15
CRASH_DD_THRESHOLD  = 0.25
MIN_HOLD_DAYS       = 3

REGIME_GATE_CONF    = 65.0
CASHOUT_RATE        = 0.10

# MSB parameters
MSB_PIVOT_BARS      = 5     # bars each side to confirm pivot high/low
MSB_ATR_PERIOD      = 5     # ATR period for breakout buffer
MSB_LOOKBACK        = 60    # bars to look back for pivot levels
MSB_WAIT_LIMIT      = 5     # days to wait for MSB before fallback entry

os.makedirs(DASHBOARD_ROOT, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ══════════════════════════════════════════
# DATA FETCHING
# ══════════════════════════════════════════

def fetch_binance_daily(symbol: str, days: int = 100) -> pd.DataFrame:
    """Fetch recent daily klines from Binance."""
    end_time   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_time = end_time - (days * 24 * 60 * 60 * 1000)

    params = {
        "symbol":    f"{symbol}USDT",
        "interval":  "1d",
        "startTime": start_time,
        "endTime":   end_time,
        "limit":     1000
    }

    try:
        r = requests.get(BINANCE_API_URL, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()

        df = pd.DataFrame(data, columns=[
            'ts', 'open', 'high', 'low', 'close', 'volume',
            'close_time', 'qv', 'trades', 'tbb', 'tbq', 'ignore'
        ])
        df['date'] = pd.to_datetime(df['ts'], unit='ms', utc=True).dt.normalize()
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = pd.to_numeric(df[col])

        # Exclude today's incomplete candle
        today_utc = pd.Timestamp.utcnow().normalize()
        df = df[df['date'] < today_utc].copy()
        df = df.set_index('date').sort_index()
        df = df[~df.index.duplicated(keep='last')]
        return df

    except Exception as e:
        logger.error(f"Failed to fetch data for {symbol}: {e}")
        return pd.DataFrame()

# ══════════════════════════════════════════
# REGIME DETECTOR
# ══════════════════════════════════════════

def calc_adx(high, low, close, period=14):
    tr   = pd.concat([high-low, (high-close.shift()).abs(), (low-close.shift()).abs()], axis=1).max(axis=1)
    up   = high.diff(); down = -low.diff()
    dm_p = up.where((up > down) & (up > 0), 0.0)
    dm_m = down.where((down > up) & (down > 0), 0.0)
    atr  = tr.ewm(alpha=1/period, adjust=False).mean()
    dip  = (dm_p.ewm(alpha=1/period, adjust=False).mean() / atr * 100).fillna(0)
    dim  = (dm_m.ewm(alpha=1/period, adjust=False).mean() / atr * 100).fillna(0)
    dx   = ((dip-dim).abs() / (dip+dim).replace(0, np.nan) * 100).fillna(0)
    return dx.ewm(alpha=1/period, adjust=False).mean()

def calc_chop(high, low, close, w=14):
    tr = pd.concat([high-low, (high-close.shift()).abs(), (low-close.shift()).abs()], axis=1).max(axis=1)
    return 100 * np.log10(tr.rolling(w).sum() / (high.rolling(w).max()-low.rolling(w).min()).replace(0, np.nan)) / np.log10(w)

def calc_bbw(close, p=20):
    mid = close.rolling(p).mean(); std = close.rolling(p).std()
    return ((mid+2*std)-(mid-2*std)) / mid.replace(0, np.nan)

def calc_er(close, p=10):
    return (close.diff(p).abs() / close.diff().abs().rolling(p).sum().replace(0, np.nan)).fillna(0)

def calc_fdi(close, w=30):
    fd = []
    for i in range(len(close)):
        if i < w: fd.append(np.nan); continue
        seg = close.iloc[i-w:i]; L = seg.max()-seg.min(); m = w//2
        sr  = (seg.iloc[:m].max()-seg.iloc[:m].min()) + (seg.iloc[m:].max()-seg.iloc[m:].min())
        fd.append(1 + np.log(sr/L)/np.log(2) if L > 0 and sr > 0 else np.nan)
    return pd.Series(fd, index=close.index)

def calculate_regime_confidence(df: pd.DataFrame) -> float:
    if len(df) < 31:
        return 0.0
    h, l, c = df["high"], df["low"], df["close"]
    adx  = calc_adx(h, l, c)
    chop = calc_chop(h, l, c)
    bbw  = calc_bbw(c)
    er   = calc_er(c)
    fdi  = calc_fdi(c)

    def norm(s, lo, hi, inv=False):
        n = ((s-lo)/(hi-lo)).clip(0,1)
        return 1-n if inv else n

    bb_lo = bbw.rolling(60).quantile(0.05).ffill()
    bb_hi = bbw.rolling(60).quantile(0.95).ffill()

    score = (norm(adx, 0, 40, inv=True) * 0.25 +
             norm(bbw, bb_lo, bb_hi, inv=True) * 0.20 +
             (1-er.clip(0,1)) * 0.15 +
             norm(fdi, 1.0, 2.0) * 0.20 +
             norm(chop, 38.2, 61.8) * 0.20)

    return float((score * 100).round(1).iloc[-1])

# ══════════════════════════════════════════
# MOMENTUM INDICATORS
# ══════════════════════════════════════════

def calculate_indicators(df: pd.DataFrame) -> dict:
    if len(df) < 31:
        return {}
    close = df['close'].values
    mom_30 = (close[-1] / close[-31] - 1) * 100
    mom_14 = (close[-1] / close[-15] - 1) * 100 if len(close) >= 15 else 0
    mom_7  = (close[-1] / close[-8]  - 1) * 100 if len(close) >= 8  else 0
    high_30 = np.max(close[-30:])
    dd_30   = (close[-1] - high_30) / high_30
    score   = SCORE_WEIGHTS[0]*mom_30 + SCORE_WEIGHTS[1]*mom_14 + SCORE_WEIGHTS[2]*mom_7
    return {
        'price':  float(close[-1]),
        'mom_30': float(mom_30),
        'mom_14': float(mom_14),
        'mom_7':  float(mom_7),
        'dd_30':  float(dd_30),
        'score':  float(score)
    }

# ══════════════════════════════════════════
# MSB (MARKET STRUCTURE BREAK) DETECTOR
# ══════════════════════════════════════════

def calc_atr(df: pd.DataFrame, period: int = 5) -> float:
    """Calculate the most recent ATR value."""
    high  = df['high']
    low   = df['low']
    close = df['close']
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs()
    ], axis=1).max(axis=1)
    atr_series = tr.rolling(period).mean()
    return float(atr_series.iloc[-1]) if not atr_series.empty else 0.0

def find_pivot_highs(df: pd.DataFrame, bars: int = 5) -> list:
    """Find confirmed pivot highs in the last MSB_LOOKBACK bars."""
    arr   = df['high'].values
    dates = df.index
    n     = len(arr)
    pivots = []
    start  = max(0, n - MSB_LOOKBACK - bars)
    for i in range(start + bars, n - bars):
        window = arr[i-bars:i+bars+1]
        if arr[i] == window.max():
            pivots.append({
                'date':  str(dates[i].date()),
                'price': float(arr[i]),
                'index': i
            })
    return pivots

def find_pivot_lows(df: pd.DataFrame, bars: int = 5) -> list:
    """Find confirmed pivot lows in the last MSB_LOOKBACK bars."""
    arr   = df['low'].values
    dates = df.index
    n     = len(arr)
    pivots = []
    start  = max(0, n - MSB_LOOKBACK - bars)
    for i in range(start + bars, n - bars):
        window = arr[i-bars:i+bars+1]
        if arr[i] == window.min():
            pivots.append({
                'date':  str(dates[i].date()),
                'price': float(arr[i]),
                'index': i
            })
    return pivots

def calculate_msb_signals(df: pd.DataFrame, asset: str) -> dict:
    """
    Calculate full MSB signal data for one asset.
    Returns a dict suitable for writing to msb_signals.json and serving to the dashboard.
    """
    if len(df) < MSB_PIVOT_BARS * 2 + 5:
        return {}

    current_price = float(df['close'].iloc[-1])
    atr           = calc_atr(df, MSB_ATR_PERIOD)
    pivot_highs   = find_pivot_highs(df, MSB_PIVOT_BARS)
    pivot_lows    = find_pivot_lows(df,  MSB_PIVOT_BARS)

    # Most recent pivot high and low
    last_ph = pivot_highs[-1] if pivot_highs else None
    last_pl = pivot_lows[-1]  if pivot_lows  else None

    # Breakout / Breakdown detection
    bullish_msb = bool(last_ph and current_price > last_ph['price'] + atr)
    bearish_msb = bool(last_pl and current_price < last_pl['price'] - atr)

    # Structure bias: are pivot highs rising (uptrend) or falling (downtrend)?
    if len(pivot_highs) >= 2:
        ph_trend = "rising" if pivot_highs[-1]['price'] > pivot_highs[-2]['price'] else "falling"
    else:
        ph_trend = "unknown"

    if len(pivot_lows) >= 2:
        pl_trend = "rising" if pivot_lows[-1]['price'] > pivot_lows[-2]['price'] else "falling"
    else:
        pl_trend = "unknown"

    # Overall structure bias
    if ph_trend == "rising" and pl_trend == "rising":
        structure = "UPTREND"
        structure_label = "Higher Highs + Higher Lows"
    elif ph_trend == "falling" and pl_trend == "falling":
        structure = "DOWNTREND"
        structure_label = "Lower Highs + Lower Lows"
    elif ph_trend == "rising" and pl_trend == "falling":
        structure = "EXPANDING"
        structure_label = "Expanding Range"
    elif ph_trend == "falling" and pl_trend == "rising":
        structure = "CONTRACTING"
        structure_label = "Contracting / Wedge"
    else:
        structure = "NEUTRAL"
        structure_label = "No clear structure"

    # Distance to key levels (as %)
    dist_to_ph = ((last_ph['price'] - current_price) / current_price * 100) if last_ph else None
    dist_to_pl = ((current_price - last_pl['price']) / current_price * 100) if last_pl else None

    # Signal label
    if bullish_msb:
        signal = "BULLISH_BREAK"
        signal_label = f"Bullish MSB — Price broke above pivot high ${last_ph['price']:,.2f}"
        signal_tone  = "bullish"
    elif bearish_msb:
        signal = "BEARISH_BREAK"
        signal_label = f"Bearish MSB — Price broke below pivot low ${last_pl['price']:,.2f}"
        signal_tone  = "bearish"
    else:
        signal = "RANGING"
        signal_label = f"No MSB — Price ranging between pivot levels"
        signal_tone  = "neutral"

    # Breakout buffer info
    breakout_level   = (last_ph['price'] + atr) if last_ph else None
    breakdown_level  = (last_pl['price'] - atr) if last_pl else None

    return {
        'asset':            asset,
        'current_price':    current_price,
        'atr':              round(atr, 4),
        'signal':           signal,
        'signal_label':     signal_label,
        'signal_tone':      signal_tone,
        'structure':        structure,
        'structure_label':  structure_label,
        'bullish_msb':      bullish_msb,
        'bearish_msb':      bearish_msb,
        'last_pivot_high':  last_ph,
        'last_pivot_low':   last_pl,
        'breakout_level':   round(breakout_level, 4)  if breakout_level  else None,
        'breakdown_level':  round(breakdown_level, 4) if breakdown_level else None,
        'dist_to_ph_pct':   round(dist_to_ph, 2) if dist_to_ph is not None else None,
        'dist_to_pl_pct':   round(dist_to_pl, 2) if dist_to_pl is not None else None,
        'ph_trend':         ph_trend,
        'pl_trend':         pl_trend,
        'recent_pivot_highs': pivot_highs[-5:],  # last 5 pivot highs for chart
        'recent_pivot_lows':  pivot_lows[-5:],   # last 5 pivot lows for chart
        'pivot_bars':       MSB_PIVOT_BARS,
        'atr_period':       MSB_ATR_PERIOD,
    }

# ══════════════════════════════════════════
# STATE MANAGEMENT
# ══════════════════════════════════════════

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading state: {e}")
    return {
        "current_position":   "CASH",
        "entry_price":        0.0,
        "entry_date":         "",
        "hold_days":          0,
        "portfolio_value_usd": 67428.0,
        "reserve_usd":        0.0,
        "last_update":        "",
        "msb_waiting":        False,
        "msb_wait_days":      0,
    }

def save_state(state: dict):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def load_history() -> list:
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading history: {e}")
    return []

def save_history(history: list):
    history = history[-100:]
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

def save_msb_signals(signals: dict, state: dict = None):
    """
    Writes msb_signals.json with:
      - per-asset MSB structural data (for the MSB panel)
      - trade_alerts: per-asset entry/stop/sell trigger (for the Trade Alert panel)
    """
    trade_alerts = {}
    for asset, sig in signals.items():
        price          = sig.get('price', 0)
        atr            = sig.get('atr', 0)
        signal         = sig.get('signal', 'RANGING')
        breakout_level = sig.get('breakout_level')   # BUY trigger
        breakdown_level= sig.get('breakdown_level')  # SELL trigger

        # Stop loss = entry - 1.5×ATR (entry = breakout_level when signal fires)
        entry_est      = breakout_level if breakout_level else price
        stop_loss_est  = round(entry_est - 1.5 * atr, 2) if atr else None
        stop_pct       = round((entry_est - stop_loss_est) / entry_est * 100, 2) if stop_loss_est and entry_est else None

        # If we're currently in this asset (from state), use actual entry price
        actual_entry   = None
        actual_stop    = None
        if state and state.get('current_position') == asset and state.get('entry_price', 0) > 0:
            actual_entry = state['entry_price']
            actual_stop  = round(actual_entry - 1.5 * atr, 2) if atr else None

        trade_alerts[asset] = {
            'signal':          signal,
            'price':           price,
            'atr':             round(atr, 2) if atr else None,
            # BUY trigger — the breakout level price must close above
            'buy_trigger':     round(breakout_level, 2) if breakout_level else None,
            'buy_trigger_pct': round((breakout_level - price) / price * 100, 2) if breakout_level and price else None,
            # SELL trigger — the breakdown level price must close below
            'sell_trigger':    round(breakdown_level, 2) if breakdown_level else None,
            'sell_trigger_pct':round((price - breakdown_level) / price * 100, 2) if breakdown_level and price else None,
            # Stop loss for a new entry at breakout level
            'stop_loss_est':   stop_loss_est,
            'stop_pct_est':    stop_pct,
            # Actual entry/stop if currently in position
            'actual_entry':    actual_entry,
            'actual_stop':     actual_stop,
            'actual_stop_pct': round((actual_entry - actual_stop) / actual_entry * 100, 2) if actual_entry and actual_stop else None,
            # Is signal active right now?
            'alert_active':    signal in ('BULLISH_BREAK', 'BEARISH_BREAK'),
        }

    payload = {
        "last_update": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "assets":       signals,
        "trade_alerts": trade_alerts,
    }
    with open(MSB_FILE, 'w') as f:
        json.dump(payload, f, indent=2)

# ══════════════════════════════════════════
# CORE STRATEGY LOGIC
# ══════════════════════════════════════════

def run_strategy():
    logger.info("Starting BULL_ROTATE v3.0 (Hybrid) execution...")

    # ── 1. Fetch Data ─────────────────────────────────────────────────────────
    market_data  = {}
    asset_dfs    = {}
    msb_signals  = {}

    for asset in ASSETS:
        df = fetch_binance_daily(asset, days=100)
        if df.empty:
            logger.error(f"Insufficient data for {asset}. Aborting.")
            return
        asset_dfs[asset] = df

        inds = calculate_indicators(df)
        if not inds:
            logger.error(f"Could not calculate indicators for {asset}. Aborting.")
            return
        market_data[asset] = inds

        # Calculate MSB signals for all assets
        msb = calculate_msb_signals(df, asset)
        if msb:
            msb_signals[asset] = msb
            logger.info(
                f"{asset}: Price=${inds['price']:.2f} | Score={inds['score']:.2f} | "
                f"30d Mom={inds['mom_30']:.2f}% | MSB={msb['signal']} | "
                f"Structure={msb['structure']}"
            )
        else:
            logger.info(f"{asset}: Price=${inds['price']:.2f} | Score={inds['score']:.2f} | 30d Mom={inds['mom_30']:.2f}%")

    # Save MSB signals for dashboard (pass state for active position data)
    # Note: state is loaded after this point, so we pass the raw loaded state here
    _pre_state = load_state()
    save_msb_signals(msb_signals, state=_pre_state)

    # ── 2. Regime Confidence ──────────────────────────────────────────────────
    btc_df      = asset_dfs['BTC']
    regime_conf = calculate_regime_confidence(btc_df)
    logger.info(f"BTC Regime Confidence: {regime_conf:.1f}%")
    market_data['BTC']['regime_conf'] = regime_conf

    # ── 3. Load State ─────────────────────────────────────────────────────────
    state        = load_state()
    history      = load_history()

    current_pos  = state.get("current_position", "CASH")
    entry_price  = state.get("entry_price", 0.0)
    hold_days    = state.get("hold_days", 0)
    portfolio_value = state.get("portfolio_value_usd", 67428.0)
    reserve_usd  = state.get("reserve_usd", 0.0)
    msb_waiting  = state.get("msb_waiting", False)
    msb_wait_days = state.get("msb_wait_days", 0)

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get("last_update") == today_str:
        logger.info("Strategy already ran for today. Exiting.")
        return

    # Update portfolio value mark-to-market
    if current_pos != "CASH" and current_pos in market_data and entry_price > 0:
        current_price = market_data[current_pos]['price']
        portfolio_value = portfolio_value * (current_price / entry_price)

    btc_data     = market_data['BTC']
    btc_msb      = msb_signals.get('BTC', {})
    action       = "HOLD"
    reason       = "No conditions met"
    target_pos   = current_pos
    new_entry_price = entry_price
    cashout_amount  = 0.0
    bull_regime  = btc_data['mom_30'] > 0

    # ── 4. Decision Logic ─────────────────────────────────────────────────────

    # ── Rule 1: Crash Exit (BTC 30d DD <= -25%) ───────────────────────────────
    if btc_data['dd_30'] <= -CRASH_DD_THRESHOLD:
        if current_pos != "CASH":
            action          = "CRASH_EXIT"
            reason          = f"BTC 30d drawdown ({btc_data['dd_30']*100:.1f}%) hit -25% threshold"
            target_pos      = "CASH"
            new_entry_price = 0.0
            portfolio_value = portfolio_value * 0.996
            msb_waiting     = False
            msb_wait_days   = 0
        else:
            action = "HOLD_CASH"
            reason = "BTC in crash state, remaining in cash"

    # ── Rule 2: Per-Position Stop Loss (-15%) ─────────────────────────────────
    elif current_pos != "CASH" and entry_price > 0:
        cur_price = market_data[current_pos]['price']
        pnl_pct   = (cur_price - entry_price) / entry_price

        if pnl_pct <= -STOP_LOSS_PCT:
            if current_pos == "BTC":
                action          = "STOP_CASH"
                reason          = f"BTC hit -15% stop loss ({pnl_pct*100:.1f}%), exiting to CASH"
                target_pos      = "CASH"
                new_entry_price = 0.0
            else:
                action          = "STOP_TO_BTC"
                reason          = f"{current_pos} hit -15% stop loss ({pnl_pct*100:.1f}%), rotating back to BTC"
                target_pos      = "BTC"
                new_entry_price = btc_data['price']
            portfolio_value = portfolio_value * 0.996
            msb_waiting     = False
            msb_wait_days   = 0

        # ── Rule 3: MSB Structural Exit (NEW in v3.0) ─────────────────────────
        elif hold_days >= MIN_HOLD_DAYS:
            pos_msb = msb_signals.get(current_pos, {})
            if pos_msb.get('bearish_msb', False):
                action          = "MSB_EXIT"
                reason          = (
                    f"MSB bearish break on {current_pos} — price broke below pivot low "
                    f"${pos_msb.get('last_pivot_low', {}).get('price', 0):,.2f}"
                )
                if current_pos == "BTC":
                    target_pos      = "CASH"
                    new_entry_price = 0.0
                else:
                    # Alt MSB exit → rotate back to BTC (safer)
                    target_pos      = "BTC"
                    new_entry_price = btc_data['price']
                portfolio_value = portfolio_value * 0.996
                msb_waiting     = False
                msb_wait_days   = 0

            # ── Rule 4: Regime Exit (BTC 30d momentum turns negative) ─────────
            elif not bull_regime:
                action          = "REGIME_EXIT"
                reason          = f"BTC 30d momentum turned negative ({btc_data['mom_30']:.1f}%), exiting to CASH"
                target_pos      = "CASH"
                new_entry_price = 0.0
                portfolio_value = portfolio_value * 0.996
                msb_waiting     = False
                msb_wait_days   = 0

            # ── Rule 5: Alt Rotation (composite score) ────────────────────────
            else:
                btc_score = btc_data['score']
                alts = [(a, data['score']) for a, data in market_data.items()
                        if a != 'BTC' and data['score'] > 0]
                alts.sort(key=lambda x: x[1], reverse=True)
                best_alt       = alts[0][0] if alts else None
                best_alt_score = alts[0][1] if alts else 0.0

                ideal_target = "BTC"
                if best_alt and best_alt_score > btc_score + ROTATION_THRESHOLD:
                    ideal_target = best_alt

                # Soft gate: block new alt rotations when regime is choppy
                if regime_conf >= REGIME_GATE_CONF and ideal_target != "BTC" and current_pos == "BTC":
                    ideal_target = "BTC"
                    if best_alt and best_alt_score > btc_score + ROTATION_THRESHOLD:
                        reason = f"Blocked rotation to {best_alt} — choppy regime ({regime_conf:.1f}%)"

                if ideal_target != current_pos:
                    action = "ROTATE"
                    reason = f"Rotating to {ideal_target} (Score: {market_data[ideal_target]['score']:.1f} vs BTC: {btc_score:.1f})"

                    # Profit cash-out on alt -> BTC rotation
                    if current_pos not in ("BTC", "CASH") and ideal_target == "BTC" and pnl_pct > 0:
                        proceeds       = portfolio_value * 0.996
                        cashout_amount = proceeds * CASHOUT_RATE
                        portfolio_value = proceeds - cashout_amount
                        reserve_usd   += cashout_amount
                        reason        += f" | Cashed out ${cashout_amount:.2f}"
                    else:
                        portfolio_value = portfolio_value * 0.996

                    target_pos      = ideal_target
                    new_entry_price = market_data[ideal_target]['price']
                else:
                    action = "HOLD"
                    reason = f"Holding {current_pos} (Score: {market_data[current_pos]['score']:.1f})"

    # ── Rule 6: Cash Re-entry with MSB gate (NEW in v3.0) ────────────────────
    elif current_pos == "CASH":
        if bull_regime:
            # Start or continue waiting for MSB entry
            if not msb_waiting:
                msb_waiting   = True
                msb_wait_days = 0
                logger.info("Regime bullish — waiting for MSB entry signal...")

            msb_wait_days += 1

            # Check for MSB bullish breakout on BTC
            btc_bull_msb = btc_msb.get('bullish_msb', False)
            eth_msb      = msb_signals.get('ETH', {})
            eth_bull_msb = eth_msb.get('bullish_msb', False)

            if btc_bull_msb:
                action          = "MSB_ENTRY_BTC"
                reason          = (
                    f"MSB bullish break on BTC — price broke above pivot high "
                    f"${btc_msb.get('last_pivot_high', {}).get('price', 0):,.2f} + ATR buffer"
                )
                target_pos      = "BTC"
                new_entry_price = btc_data['price']
                portfolio_value = portfolio_value * 0.996
                msb_waiting     = False
                msb_wait_days   = 0

            elif eth_bull_msb and regime_conf < REGIME_GATE_CONF:
                action          = "MSB_ENTRY_ETH"
                reason          = (
                    f"MSB bullish break on ETH — price broke above pivot high "
                    f"${eth_msb.get('last_pivot_high', {}).get('price', 0):,.2f} + ATR buffer"
                )
                target_pos      = "ETH"
                new_entry_price = market_data['ETH']['price']
                portfolio_value = portfolio_value * 0.996
                msb_waiting     = False
                msb_wait_days   = 0

            elif msb_wait_days >= MSB_WAIT_LIMIT:
                # Fallback: enter BTC after MSB_WAIT_LIMIT days without a clean MSB
                action          = "REENTER_BTC"
                reason          = (
                    f"BTC 30d momentum positive ({btc_data['mom_30']:.1f}%), "
                    f"no MSB in {msb_wait_days} days — fallback entry"
                )
                target_pos      = "BTC"
                new_entry_price = btc_data['price']
                portfolio_value = portfolio_value * 0.996
                msb_waiting     = False
                msb_wait_days   = 0

            else:
                action = "HOLD_CASH"
                reason = (
                    f"Regime bullish — waiting for MSB entry signal "
                    f"(day {msb_wait_days} of {MSB_WAIT_LIMIT})"
                )

        else:
            # Regime not bullish — stay in cash, reset MSB wait
            msb_waiting   = False
            msb_wait_days = 0
            action        = "HOLD_CASH"
            reason        = f"BTC 30d momentum negative ({btc_data['mom_30']:.1f}%)"

    # ── 5. Update State ───────────────────────────────────────────────────────
    if target_pos != current_pos:
        hold_days   = 0
        entry_date  = today_str
    else:
        hold_days  += 1
        entry_date  = state.get("entry_date", today_str)

    new_state = {
        "current_position":   target_pos,
        "entry_price":        new_entry_price,
        "entry_date":         entry_date,
        "hold_days":          hold_days,
        "portfolio_value_usd": portfolio_value,
        "reserve_usd":        reserve_usd,
        "total_wealth_usd":   portfolio_value + reserve_usd,
        "last_update":        today_str,
        "action":             action,
        "reason":             reason,
        "market_data":        market_data,
        "msb_waiting":        msb_waiting,
        "msb_wait_days":      msb_wait_days,
        "strategy_version":   "v3.0",
    }
    save_state(new_state)

    # ── 6. Update History ─────────────────────────────────────────────────────
    history_record = {
        "date":            today_str,
        "position":        target_pos,
        "action":          action,
        "reason":          reason,
        "portfolio_value": portfolio_value,
        "reserve_usd":     reserve_usd,
        "cashout_amount":  cashout_amount,
        "btc_price":       btc_data['price'],
        "btc_dd":          btc_data['dd_30'],
        "btc_mom":         btc_data['mom_30'],
        "regime_conf":     regime_conf,
        "msb_signal":      btc_msb.get('signal', 'UNKNOWN'),
        "msb_structure":   btc_msb.get('structure', 'UNKNOWN'),
        "entry_price":     new_entry_price if target_pos != "CASH" else 0.0,
    }
    history.append(history_record)
    save_history(history)

    logger.info(
        f"Execution complete. Action: {action} | Target: {target_pos} | Reason: {reason}"
    )
    logger.info(
        f"Portfolio Value: ${portfolio_value:.2f} | Reserve: ${reserve_usd:.2f} | "
        f"Total Wealth: ${portfolio_value + reserve_usd:.2f}"
    )

if __name__ == "__main__":
    run_strategy()
