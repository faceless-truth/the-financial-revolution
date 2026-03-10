# The Financial Revolution — Project TODO

## Core Dashboard
- [x] Strategy dashboard with 6 panels (Signal, Re-Entry, BTC Health, Momentum, Decision Flow, Chart)
- [x] Live Binance API data fetching every 5 minutes
- [x] 30-day momentum period (not 14-day)
- [x] 4-rule decision flow (Cash Trigger → Min-Hold → BTC Rally → Breakout)
- [x] Leverage disabled in v7.0 Conservative
- [x] Confidence Score v3 (F&G 55% + STH Proxy 45%)
- [x] Per-asset sparklines and detail cards

## Portfolio
- [x] Portfolio tab with live P&L and equity curve
- [x] Starting capital: $71,400 USD
- [x] Current position: 1.0657 BTC at $67,000 entry on 2026-03-08
- [x] Trade log with actual BUY entry seeded
- [x] localStorage v4 persistence

## Authentication & Security
- [x] Password gate (password: "A") protecting entire dashboard
- [x] sessionStorage-based unlock state

## PWA & Push Notifications
- [x] PWA manifest.json with TFR icon
- [x] Service worker (sw.js) for offline caching and push handling
- [x] Apple touch icon and iOS PWA meta tags
- [x] VAPID keys generated and stored as environment variables
- [x] Push subscription backend (save/delete/list subscriptions in DB)
- [x] Signal change detection and push notification fan-out
- [x] Frontend notification bell (enable/disable in header)
- [x] usePushNotifications hook wired to signal changes

## Infrastructure
- [x] Full-stack upgrade (Express + tRPC + Drizzle ORM)
- [x] Database tables: push_subscriptions, signal_state
- [x] VAPID keys as env vars (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
- [x] All backend dependencies installed (dotenv, drizzle-orm, mysql2, jose, superjson, @trpc/*)

## Trade Price Entry
- [x] trade_log database table created and migrated
- [x] Trade router (getTrades, logTrade, deleteTrade) with tRPC procedures
- [x] TradeEntryModal — appears automatically when signal changes, pre-fills estimated price
- [x] TradeLogPanel — full trade history below per-asset cards
- [x] 10 vitest tests passing (push + trade + auth)
- [x] Trade log rows redesigned: buy/sell price is the hero element (large, colour-coded)
- [x] "Log my buy/sell price" button added directly inside the Today's Signal panel

## PWA Icons
- [x] TFR icon resized to 192×192, 512×512, 180×180 and uploaded to CDN
- [x] manifest.json updated with separate sized icons
- [x] apple-touch-icon updated to 180px version

## Portfolio Trade History Fix
- [x] usePortfolio seeded with BUY at $67,000 (2026-03-08) and SELL at $67,250 (2026-03-10)
- [x] Portfolio state updated to CASH after sell
- [x] Storage key bumped to v5 to force re-seed on next page load

## Future Enhancements
- [ ] "Remember me" toggle for password (localStorage vs sessionStorage)
- [ ] Connect to DigitalOcean script output JSON for exact trade matching
- [ ] Custom domain www.thefinancialrevolution.com.au fully verified

## v7.1 Strategy Upgrade
- [x] useBinanceData: bump version label to v7.1
- [x] useBinanceData: SUI/DOGE cap changed from 60% to 35%
- [x] useBinanceData: MIN_HOLD_DAYS changed from 14 to 7
- [x] useBinanceData: BTC_NEW_HIGH_DAYS changed from 5 to 3
- [x] useBinanceData: confidence zone thresholds updated (HIGH ≥0.65, MED-HIGH 0.55-0.64, MED 0.45-0.54, MED-LOW 0.35-0.44, LOW <0.35)
- [x] useBinanceData: new Rule 2 re-entry gate (in_full_cash state, before asset ranking)
- [x] useBinanceData: new Rule 3 all-negative exit (7-day block, sets in_full_cash)
- [x] useBinanceData: rule numbering updated (min-hold=Rule 4, rally=Rule 5, breakout=Rule 6)
- [x] useBinanceData: all_negative boolean flag on signal output
- [x] useBinanceData: all_neg_exits and all_neg_blocked counters on signal output
- [x] Home.tsx: update header to show v7.1
- [x] Home.tsx: update strategy parameter table to show new values (7d hold, 3d rally, 35% SUI/DOGE)
- [x] Home.tsx: add All-Negative indicator in signal/BTC Health panel
- [x] Home.tsx: update rule labels in signal display (Rule 3=ALL_NEGATIVE, renumber others)
- [x] Home.tsx: update backtest stats to v7.1 figures (CAGR 10.1%, Sharpe 0.437, Max DD -47.4%)

## Change Password Feature
- [x] Change Password modal accessible from inside the dashboard after login
- [x] Validates current password before allowing change
- [x] Saves new password to localStorage
- [x] Shows success confirmation
- [x] Settings gear icon added to dashboard header (next to bell)
