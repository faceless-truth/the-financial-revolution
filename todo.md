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

## PWA Icons
- [x] TFR icon resized to 192×192, 512×512, 180×180 and uploaded to CDN
- [x] manifest.json updated with separate sized icons
- [x] apple-touch-icon updated to 180px version

## Future Enhancements
- [ ] "Remember me" toggle for password (localStorage vs sessionStorage)
- [ ] Connect to DigitalOcean script output JSON for exact trade matching
- [ ] Custom domain www.thefinancialrevolution.com.au fully verified
