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
