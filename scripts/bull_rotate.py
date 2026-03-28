#!/usr/bin/env python3
"""
BULL_ROTATE v2.0
────────────────────────────────
Systematic bull-market outperformance strategy.
- Universe: BTC, ETH, DOGE
- Default holding: BTC
- Rotation threshold: Alt composite score > BTC score + 30pp
- Per-position stop loss: -15% from entry price
- Crash exit: BTC 30d drawdown <= -25% -> 100% CASH
- Cash re-entry: BTC 30d momentum > 0 -> BTC
- Minimum hold period: 3 days
- Runs daily at 00:05 UTC after Binance daily close
"""

import pandas as pd
import numpy as np
from datetime import datetime, timezone, timedelta
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
LOG_FILE            = os.path.join(DASHBOARD_ROOT, "bull_rotate.log")

BINANCE_API_URL     = "https://api.binance.com/api/v3/klines"

ASSETS              = ['BTC', 'ETH', 'DOGE']
SCORE_WEIGHTS       = (0.5, 0.3, 0.2)  # 30d, 14d, 7d
ROTATION_THRESHOLD  = 30.0
STOP_LOSS_PCT       = 0.15
CRASH_DD_THRESHOLD  = 0.25
MIN_HOLD_DAYS       = 3

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

def fetch_binance_daily(symbol: str, days: int = 60) -> pd.DataFrame:
    """Fetch recent daily klines from Binance."""
    end_time = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_time = end_time - (days * 24 * 60 * 60 * 1000)
    
    url = BINANCE_API_URL
    params = {
        "symbol": f"{symbol}USDT",
        "interval": "1d",
        "startTime": start_time,
        "endTime": end_time,
        "limit": 1000
    }
    
    try:
        r = requests.get(url, params=params, timeout=10)
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

def calculate_indicators(df: pd.DataFrame) -> dict:
    """Calculate momentum and drawdown indicators for the latest closed day."""
    if len(df) < 31:
        return {}
        
    close = df['close'].values
    
    mom_30 = (close[-1] / close[-31] - 1) * 100
    mom_14 = (close[-1] / close[-15] - 1) * 100 if len(close) >= 15 else 0
    mom_7  = (close[-1] / close[-8] - 1) * 100 if len(close) >= 8 else 0
    
    high_30 = np.max(close[-30:])
    dd_30 = (close[-1] - high_30) / high_30
    
    score = SCORE_WEIGHTS[0] * mom_30 + SCORE_WEIGHTS[1] * mom_14 + SCORE_WEIGHTS[2] * mom_7
    
    return {
        'price': float(close[-1]),
        'mom_30': float(mom_30),
        'mom_14': float(mom_14),
        'mom_7': float(mom_7),
        'dd_30': float(dd_30),
        'score': float(score)
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
    
    # Default initial state
    return {
        "current_position": "CASH",
        "entry_price": 0.0,
        "entry_date": "",
        "hold_days": 0,
        "portfolio_value_usd": 10000.0,
        "last_update": ""
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
    # Keep last 100 records
    history = history[-100:]
    with open(HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2)

# ══════════════════════════════════════════
# CORE LOGIC
# ══════════════════════════════════════════

def run_strategy():
    logger.info("Starting BULL_ROTATE v2.0 execution...")
    
    # 1. Fetch Data & Calculate Indicators
    market_data = {}
    for asset in ASSETS:
        df = fetch_binance_daily(asset, days=40)
        if df.empty:
            logger.error(f"Insufficient data for {asset}. Aborting.")
            return
        inds = calculate_indicators(df)
        if not inds:
            logger.error(f"Could not calculate indicators for {asset}. Aborting.")
            return
        market_data[asset] = inds
        logger.info(f"{asset}: Price=${inds['price']:.2f} | Score={inds['score']:.2f} | 30d Mom={inds['mom_30']:.2f}% | 30d DD={inds['dd_30']*100:.2f}%")

    # 2. Load State
    state = load_state()
    history = load_history()
    
    current_pos = state.get("current_position", "CASH")
    entry_price = state.get("entry_price", 0.0)
    hold_days = state.get("hold_days", 0)
    portfolio_value = state.get("portfolio_value_usd", 10000.0)
    
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if state.get("last_update") == today_str:
        logger.info("Strategy already ran for today. Exiting.")
        return

    # Update portfolio value based on current price if holding an asset
    if current_pos != "CASH" and current_pos in market_data and entry_price > 0:
        current_price = market_data[current_pos]['price']
        portfolio_value = portfolio_value * (current_price / entry_price)
        # We don't save this updated value yet, we wait until the end of the logic

    btc_data = market_data['BTC']
    action = "HOLD"
    reason = "No conditions met"
    target_pos = current_pos
    new_entry_price = entry_price

    # 3. Evaluate Rules
    
    # Rule 1: Crash Exit (BTC 30d DD <= -25%)
    if btc_data['dd_30'] <= -CRASH_DD_THRESHOLD:
        if current_pos != "CASH":
            action = "CRASH_EXIT"
            reason = f"BTC 30d drawdown ({btc_data['dd_30']*100:.1f}%) hit -25% threshold"
            target_pos = "CASH"
            new_entry_price = 0.0
            portfolio_value = portfolio_value * 0.996 # 0.4% fee
        else:
            action = "HOLD_CASH"
            reason = "BTC in crash state, remaining in cash"
            
    # Rule 2: Cash Re-entry (BTC 30d Mom > 0)
    elif current_pos == "CASH":
        if btc_data['mom_30'] > 0:
            action = "REENTER_BTC"
            reason = f"BTC 30d momentum positive ({btc_data['mom_30']:.1f}%), re-entering market"
            target_pos = "BTC"
            new_entry_price = btc_data['price']
            portfolio_value = portfolio_value * 0.996
        else:
            action = "HOLD_CASH"
            reason = f"BTC 30d momentum still negative ({btc_data['mom_30']:.1f}%)"

    # Rule 3: Per-Position Stop Loss (-15%)
    elif current_pos != "CASH":
        current_price = market_data[current_pos]['price']
        pnl_pct = (current_price - entry_price) / entry_price
        
        if pnl_pct <= -STOP_LOSS_PCT:
            if current_pos == "BTC":
                action = "STOP_CASH"
                reason = f"BTC hit -15% stop loss ({pnl_pct*100:.1f}%), exiting to CASH"
                target_pos = "CASH"
                new_entry_price = 0.0
            else:
                action = "STOP_TO_BTC"
                reason = f"{current_pos} hit -15% stop loss ({pnl_pct*100:.1f}%), rotating back to BTC"
                target_pos = "BTC"
                new_entry_price = btc_data['price']
            portfolio_value = portfolio_value * 0.996
            
        # Rule 4: Bull Rotation
        else:
            btc_score = btc_data['score']
            alts = [(a, data['score']) for a, data in market_data.items() if a != 'BTC' and data['score'] > 0]
            alts.sort(key=lambda x: x[1], reverse=True)
            
            best_alt = alts[0][0] if alts else None
            best_alt_score = alts[0][1] if alts else 0.0
            
            # Determine ideal target
            ideal_target = "BTC"
            if best_alt and best_alt_score > btc_score + ROTATION_THRESHOLD:
                ideal_target = best_alt
                
            if ideal_target != current_pos:
                if hold_days < MIN_HOLD_DAYS:
                    action = "HOLD_MIN"
                    reason = f"Want to rotate to {ideal_target} but blocked by {MIN_HOLD_DAYS}d min hold (day {hold_days})"
                else:
                    action = "ROTATE"
                    reason = f"Rotating to {ideal_target} (Score: {market_data[ideal_target]['score']:.1f} vs BTC: {btc_score:.1f})"
                    target_pos = ideal_target
                    new_entry_price = market_data[ideal_target]['price']
                    portfolio_value = portfolio_value * 0.996
            else:
                action = "HOLD"
                reason = f"Holding {current_pos} (Score: {market_data[current_pos]['score']:.1f})"

    # 4. Update State
    if target_pos != current_pos:
        hold_days = 0
        entry_date = today_str
    else:
        hold_days += 1
        entry_date = state.get("entry_date", today_str)

    new_state = {
        "current_position": target_pos,
        "entry_price": new_entry_price,
        "entry_date": entry_date,
        "hold_days": hold_days,
        "portfolio_value_usd": portfolio_value,
        "last_update": today_str,
        "action": action,
        "reason": reason,
        "market_data": market_data
    }
    
    save_state(new_state)
    
    # 5. Update History
    history_record = {
        "date": today_str,
        "position": target_pos,
        "action": action,
        "reason": reason,
        "portfolio_value": portfolio_value,
        "btc_price": btc_data['price'],
        "btc_dd": btc_data['dd_30'],
        "btc_mom": btc_data['mom_30']
    }
    history.append(history_record)
    save_history(history)
    
    logger.info(f"Execution complete. Action: {action} | Target: {target_pos} | Reason: {reason}")
    logger.info(f"Portfolio Value: ${portfolio_value:.2f}")

if __name__ == "__main__":
    run_strategy()
