#!/usr/bin/env python3
"""
Backfill daily OHLCV from Binance for the 5-asset BULL_ROTATE universe.

Pulls every 1d candle from each asset's listing date through yesterday UTC,
paginating through /api/v3/klines (500 bars per request, hard limit).
Writes one CSV per asset to a fresh output directory — does NOT touch the
existing /data/ohlcv_full/ files.

Usage:
    python3 backtests/backfill_binance.py
    python3 backtests/backfill_binance.py --out-dir /root/crypto_dashboard/data/ohlcv_backtest
    python3 backtests/backfill_binance.py --assets BTCUSDT ETHUSDT SOLUSDT

Output CSV columns (matching the format the backtest loader expects):
    timestamp, open, high, low, close, volume

The 'timestamp' column is the kline open time as ISO-8601 UTC.
"""
from __future__ import annotations
import argparse
import csv
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
import json

BINANCE_KLINES = "https://api.binance.com/api/v3/klines"

# Approximate Binance listing dates (UTC). The script will start from these
# and let Binance return whatever's available — Binance happily ignores
# pre-listing requests and returns the earliest data it has.
LISTING_DATES = {
    "BTCUSDT":  "2017-08-17",
    "ETHUSDT":  "2017-08-17",
    "SOLUSDT":  "2020-08-11",
    "DOGEUSDT": "2019-07-05",
    "SUIUSDT":  "2023-05-03",
}

DEFAULT_ASSETS = list(LISTING_DATES.keys())


def to_ms(dt_str: str) -> int:
    return int(datetime.strptime(dt_str, "%Y-%m-%d")
               .replace(tzinfo=timezone.utc).timestamp() * 1000)


def fetch_page(symbol: str, start_ms: int, end_ms: int) -> list:
    """One Binance kline request — up to 500 daily bars."""
    params = {
        "symbol": symbol,
        "interval": "1d",
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": 1000,  # Binance accepts up to 1000 for klines
    }
    url = f"{BINANCE_KLINES}?{urlencode(params)}"
    with urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def backfill_asset(symbol: str, start_date: str, end_ms: int,
                   sleep_s: float = 0.25) -> list[dict]:
    """Paginate from start_date until we hit end_ms. Returns list of rows."""
    rows = []
    cursor = to_ms(start_date)
    page = 0
    while cursor < end_ms:
        page += 1
        try:
            batch = fetch_page(symbol, cursor, end_ms)
        except Exception as e:
            print(f"  [{symbol}] page {page} failed: {e} — retrying after 5s")
            time.sleep(5)
            batch = fetch_page(symbol, cursor, end_ms)

        if not batch:
            break

        for k in batch:
            # Kline format: [open_time, open, high, low, close, volume,
            #                close_time, qv, trades, tbb, tbq, ignore]
            rows.append({
                "timestamp": datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
                                     .strftime("%Y-%m-%d %H:%M:%S+00:00"),
                "open":   k[1],
                "high":   k[2],
                "low":    k[3],
                "close":  k[4],
                "volume": k[5],
            })

        last_open_ms = batch[-1][0]
        # Advance cursor past the last bar we received.
        next_cursor = last_open_ms + 24 * 60 * 60 * 1000
        if next_cursor <= cursor:
            break
        cursor = next_cursor

        print(f"  [{symbol}] page {page}: {len(batch)} bars, "
              f"through {datetime.fromtimestamp(last_open_ms/1000, tz=timezone.utc).date()}")
        time.sleep(sleep_s)

    return rows


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        w.writeheader()
        w.writerows(rows)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out-dir", type=Path,
                   default=Path("/root/crypto_dashboard/data/ohlcv_backtest"),
                   help="Where to write the backfilled CSVs")
    p.add_argument("--assets", nargs="+", default=DEFAULT_ASSETS,
                   help="Binance symbols to backfill (default: 5-asset universe)")
    p.add_argument("--sleep", type=float, default=0.25,
                   help="Sleep between paginated requests (seconds)")
    args = p.parse_args()

    # Stop at the most recent FULL UTC day (= yesterday). Today's bar is incomplete.
    today_utc = datetime.now(timezone.utc).date()
    yesterday_end_ms = int(datetime.combine(today_utc, datetime.min.time(),
                                            tzinfo=timezone.utc).timestamp() * 1000) - 1

    print(f"Out dir:     {args.out_dir}")
    print(f"End cutoff:  {today_utc} 00:00 UTC (last bar = {datetime.fromtimestamp(yesterday_end_ms/1000, tz=timezone.utc).date()})")
    print(f"Assets:      {', '.join(args.assets)}\n")

    summary = []
    for symbol in args.assets:
        start = LISTING_DATES.get(symbol, "2017-08-17")
        print(f"--- {symbol} from {start} ---")
        rows = backfill_asset(symbol, start, yesterday_end_ms, args.sleep)
        if not rows:
            print(f"  [{symbol}] no data returned")
            continue

        # File naming: BTCUSDT_1d.csv → matches what the loader expects (loader
        # strips coin prefix automatically). Writing to ohlcv_backtest/ keeps
        # the live cron-updated files in ohlcv_full/ untouched.
        path = args.out_dir / f"{symbol}_1d.csv"
        write_csv(rows, path)
        first = rows[0]["timestamp"][:10]
        last = rows[-1]["timestamp"][:10]
        print(f"  [{symbol}] wrote {len(rows)} bars: {first} → {last}\n")
        summary.append((symbol, len(rows), first, last))

    print("=" * 60)
    print("BACKFILL SUMMARY")
    print("=" * 60)
    for s, n, f, l in summary:
        print(f"  {s}: {n} bars, {f} → {l}")
    print(f"\nFiles in: {args.out_dir}")


if __name__ == "__main__":
    main()
