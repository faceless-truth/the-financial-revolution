# CLAUDE.md — The Financial Revolution dashboard

Persistent project context for Claude Code. Place at repo root (`/root/website/CLAUDE.md`).
Read this fully before editing anything.

## What this project is

A live crypto rotation dashboard for **BULL_ROTATE**, a systematic daily strategy
holding ONE asset at a time from {BTC, ETH, SOL, DOGE, SUI} or 100% CASH.
A Python script runs on cron and writes state files; a Node/Express server reads
them and serves `/api/live-dashboard`; a React frontend renders them.

## Architecture — the data flow is the whole job

```
scripts/bull_rotate_v*.py   (cron, ~00:05 UTC)
        │  writes state + history + dashboard JSON
        ▼
server/livePortfolio.ts     reads JSON files → GET /api/live-dashboard
        ▼
client/src/pages/Portfolio.tsx   fetches /api/live-dashboard → renders
```

**Hard rule: a metric can only render if it exists in the JSON the Python emits.**
If a desired metric is NOT already in the dashboard JSON, the correct order is:
1. add it to the Python emitter (the strategy's dashboard-write step),
2. pass it through `livePortfolio.ts` (no transformation unless necessary),
3. then render it in `Portfolio.tsx`.
Never render a field that isn't backed by emitted state. Do not fabricate values.

## Key files

| Goal | File |
|---|---|
| Dashboard UI / layout / what's displayed | `client/src/pages/Portfolio.tsx` |
| Data served to the frontend | `server/livePortfolio.ts` |
| Strategy logic (DO NOT edit for dashboard work) | `scripts/bull_rotate_v*.py` |
| Nav / page shell | `client/src/components/DashboardLayout.tsx` |
| Routes | `client/src/App.tsx` |

Build: `pnpm build` → `dist/`.

## Bull Rotation Testing view (2026-09)

The primary public route is `/bull-rotation` (`client/src/pages/BullRotation.tsx`).
Its **Testing** tab now displays only the isolated matched paper pair: original
v5.0 control versus the frozen +50% activation / 20% trailing candidate. Both
start with the same virtual CASH balance; neither is the actual account on
Dashboard. Legacy paper-candidate, decay and weekly-testing tables were removed
from the view, not from the historical archives or regression suite.

- Producer: `/root/crypto_dashboard/research/publish_profit_trail_comparison.py`.
- Snapshot: `/root/crypto_dashboard/data/public/profit_trail_comparison.json`.
- The 00:15 UTC paper-only daily CLI publishes after success/no-op and on failure.
- `server/bullRotation.ts` reads this independent snapshot on **every request**,
  overriding any embedded main-payload copy to avoid same-minute cron races.
- `/api/bull-rotation` uses `Cache-Control: no-store`; UI polls every five minutes.
- UI: `client/src/components/PaperComparison.tsx`; contract: `shared/paperComparison.ts`.
- Drawdown is signed nonpositive; lead return is **percentage points**, not a
  relative-percent calculation. Financial metrics are emitted in Python only.
- Initial seed balances are not observations. Preserve unavailable/stale/error
  states and the client-side overdue check even if the publisher stops.

Deployment is `/root/website`: nginx sends the domain to localhost:3001. Build
then restart **only** PM2 `financial-revolution`, preserving its existing launch
configuration. Do not restart the unrelated `tfr-frontend` app or replace the
live process using the ecosystem file without checking its launch definition.

## Private Bybit account view (2026-09-21)

The read-only connection is implemented and verified for Spot/Unified balances
and linear/inverse derivatives, not Funding/options positions. Detailed Portfolio
mounts `BybitAccount.tsx` separately from strategy-model metrics and paper Testing.
See `BYBIT_READ_ONLY_SETUP.md` for operator instructions and limits.

- Credentials: `/etc/crypto-dashboard/bybit-readonly.env`, server-only owner permissions.
- Separate private password: `sudo python3 scripts/setup_bybit_owner.py` over SSH;
  salted scrypt verifier at `/etc/crypto-dashboard/bybit-owner-auth.json`.
- `server/bybitRoutes.ts` protects `/api/bybit/account` with opaque HttpOnly Secure
  owner sessions. The existing client-only PasswordGate does NOT authorize it.
- `server/bybitReadOnly.ts` is lazy, GET-only and verifies explicit readOnly=1
  before collecting account data. No orders/withdrawals/transfers are submitted.
- The primary private view is **Investment portfolio — Bybit spot**, served by
  owner-protected `/api/bybit/portfolio`. `bybitSpotHistory.ts` retains actual
  executions and base-coin transaction logs in private, account-bound archives;
  `bybitSpotLedger.ts` computes FIFO cost, sales and unrealized P&L with Decimal.
  Never substitute model entry dates, current prices as missing basis, deposits
  as profits, or sum different quote currencies. See `BYBIT_SPOT_PERFORMANCE.md`.
  The unlocked view is restricted to BTC/SOL/SUI/DOGE/HYPE/ETH: current unrealized
  P&L only, five spot trades with Show more, and 12-/18-/24-month closed-return
  percentages. No balance/derivatives display. `bybitSpotReturns.ts` uses exact
  sale-fill dates and summed net P&L / matched sold cost per quote currency;
  unknown costs/fees are excluded and counted, partial coverage is disclosed.
- Production index mounts the private router before the global parser/static SPA,
  trusts only loopback proxy headers and enforces HTTPS, private/no-store responses.
- Set CSP unconditionally in this deployed entrypoint: the actual PM2 bash launch
  may leave NODE_ENV unset. Never reintroduce production analytics/session replay
  or service-worker caching/offline fallback for private account responses.
- Never copy Bybit credentials, raw API-key information or account snapshots into
  public strategy/paper JSON, frontend variables, browser storage or logs.

At deployment the API credentials worked, but the separate owner-password file
was not yet configured; the card correctly remained locked. Configuring that
password takes effect without restart. Do not create a default/bypass password.

## FIRST STEP before any redesign — audit, don't assume

1. Confirm **which script the cron actually runs** (`crontab -l`) and read THAT file.
   There are multiple versions on disk (v4, v4.1). The dashboard must describe the
   logic that is actually live, not whichever file is newest. If unsure, stop and ask.
2. Open the dashboard JSON the live script writes and list every field that ALREADY
   exists. Map each desired metric below to: "already emitted" vs "needs to be added."
3. Report that mapping before writing UI. The UI plan depends on it.

## Constraints (these override convenience)

- **Analytics/telemetry is strictly separate from trading logic.** The dashboard is
  read-only display. Nothing the dashboard does may feed back into a trade decision.
  Any efficiency/regime telemetry (e.g. Kaufman ER, Hurst, information discreteness)
  is DISPLAY ONLY and lives outside the strategy's decision path.
- **State-file backward compatibility:** any new field read from state must use a
  safe default (`.get(...)` in Python, `?? fallback` / optional chaining in TS).
  Never assume a new field exists on old state records.
- **Surgical edits, not rewrites.** Prefer minimal targeted diffs to `Portfolio.tsx`
  and `livePortfolio.ts`. Do not restructure files that aren't part of the task.
- **Do not touch `scripts/bull_rotate_v*.py` trading logic.** The only acceptable
  Python edit is the dashboard-write step, to emit additional metrics — and only
  after confirming with the user.
- If a metric is expensive or risky to emit, surface that tradeoff rather than
  silently skipping or faking it.

## Metric vocabulary to surface (from the strategy spec)

Group these into clear dashboard panels. Show state-appropriate views: an IN-POSITION
layout differs from a CASH layout.

**Header / status**
- Strategy version (the one actually live), universe, last update (UTC), execution time.
- Current state: held asset OR CASH; portfolio value; reserve (cashed-out) balance.

**Entry state (when in/considering entry)**
- Regime gate: BTC 30-day momentum (and whether bull-confirmed, >0%).
- MSB gate: days waited vs 5-day limit; pending entry signal
  (MSB_ENTRY_BTC / MSB_ENTRY_ETH / REENTER_BTC).

**Exit telemetry (when in position)** — show as a prioritized checklist with live distances:
1. Crash exit — BTC 30-day drawdown vs −25% threshold.
2. Stop loss — current position vs −15% from entry.
3. MSB structural exit — pivot-low break (active only after 7-day min hold).
4. Regime exit — BTC 30-day momentum vs −5% (active only after 7-day min hold);
   show the rolling regime-exit PRICE level (price_30d_ago × 0.95).
- Min-hold countdown: days held vs MIN_HOLD_DAYS (7).

**Rotation (TFR composite score)**
- Per-asset composite score and the component breakdown actually emitted
  (RSI score, ATR/price, EMA50 trend, MSB signal, Omega, ROC, volume conviction).
- Current holding's score vs best alternative; rotation threshold (+1.5).
- Regime soft-gate state (choppy block ≥65% confidence), if emitted.

**Market structure (MSB)**
- Current structure classification (UPTREND / DOWNTREND / EXPANDING / CONTRACTING),
  latest pivot high/low, ATR buffer.

**Reference / static**
- Key parameters table; backtest summary (clearly labelled as historical, with period).

## Tone for any user-facing copy

Factual and systematic. Label historical/backtest figures as such. No hype.
This is a dashboard describing a live rule-based system, not marketing.

## Scarton SMSF page (2026-10-18)

Dedicated owner-gated page at `/smsf` (`client/src/pages/Smsf.tsx`, Cockpit
shell around `client/src/components/cockpit/SmsfView.tsx`), independent of the
Bull Rotation payload. The Cockpit sidebar links to it, and old
`/bull-rotation#smsf` links redirect there. The owner's SMSF at IBKR:
equal fifths of VT, TLT, GLDM, REET, IBIT, each timed monthly by price vs the
mean of the last 252 unadjusted daily closes (sell on the last trading day if
below; buy back on the first trading day if above; no cross-sleeve rebalance).

- Producer: `/root/crypto_dashboard/scripts/smsf_trend.py` (yfinance; cron
  22:30 UTC Mon–Fri) → `data/public/smsf_dashboard.json`, atomic, keeps the last
  good file on failure. Tests: `tests/test_smsf_trend.py`.
- `server/smsf.ts` → `GET /api/smsf` (pass-through, behind the owner login).
- Backtest splices GLD before GLDM and BTC-USD (−0.25%/yr) before IBIT; cash = BIL.
- Main rules = version B (`rule_rebalanced`): reset all to equal fifths at
  every buy-back; funds still below their average keep their fifth as cash.
- Live forward test of A, B, hold-yearly, hold-never from the fixed start in
  `/root/crypto_dashboard/data/smsf_forward_inception.json` (2026-10-16 close).
  Never edit or delete it: each run replays all versions from that close; a
  corrupt file fails the run rather than restarting the test.
- Model holdings are derived from prices, not actual IBKR holdings.
