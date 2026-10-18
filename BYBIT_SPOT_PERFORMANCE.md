# Actual Bybit spot investment performance

This replaces the default balance mirror in Detailed Portfolio with purchases,
sales, FIFO purchase cost and current unrealized P&L from **actual exchange fills**.
The unlocked view is restricted to BTC, SOL, SUI, DOGE, HYPE and ETH. Balance and
derivatives diagnostics are no longer displayed. Trading scripts, archived account
records and paper Testing are unchanged.

## Scope and data

- Private, owner-authenticated `GET /api/bybit/portfolio`.
- The same server-only read-only key verification and UTA2 account checks apply.
- Actual `GET /v5/execution/list?category=spot` records, paginated in <=7-day windows.
- Initial retrieval reaches approximately two years back, within the venue's
  documented retention. A one-day safety margin avoids requesting an expired
  boundary while an import is running. The displayed dates are the actual scope.
- Verified spot instrument metadata supplies base/quote currencies; unresolved
  pairs are not guessed from suffixes for cost accounting.
- For each traded noncash base asset, retrieve its Unified transaction log from
  one day before its earliest available execution through the import endpoint.
  Transfers, adjustments and base-coin debits therefore cannot silently become
  purchases or profits. Cash-currency interest is not included in spot trading P&L.
- Latest matching-pair **bid** supplies the open-position mark. A missing bid is
  unavailable, not replaced by the last purchase price or a fabricated zero.

The initial import is resumable. Completed windows and partial-page cursors are
checkpointed; later requests overlap recent history so new/late fills are merged
without double counting. Once captured, older records are not pruned just because
the vendor's rolling retention moves forward.

## Private storage

Default: `/var/lib/crypto-dashboard-private/bybit-spot/`, mode 700, with mode-600
archives and identity/lock files. This is outside the website, Git and public data.
The namespace hashes verified venue origin plus account identity, not the API key,
so rotating a key for the same account can retain its history. Raw account IDs,
keys, secrets and signatures are not returned to the browser or stored in history.

Archives are checksummed, atomically replaced and account-bound. Missing/corrupt
established history fails closed rather than silently resetting to no purchases.
Concurrent imports are locked; only a verified dead process's lock can be recovered,
not a merely old or inaccessible/live writer. Initial archive recovery after an
interrupted marker write may require operator inspection. No exchange writes occur.

## Accounting

- Aggregate actual partial fills into buy/sell orders with first/last execution
  timestamps and volume-weighted executed price; unfilled/cancelled quantities
  are not treated as purchases.
- Match actual sell quantities to purchase lots using **FIFO**. Partial sales
  release proportional cost; final consumption releases exact remaining cost.
- Buy fees paid in base coin reduce received units; quote fees increase purchase
  cost. Sell quote fees reduce proceeds; base fees also consume inventory.
  Rebates are signed rather than discarded. The paper strategy's modeled 0.4%
  charge is **not** substituted for actual fees.
- Execution quantity/fee precision can exceed the venue transaction ledger's
  reported precision. Precise fill quantities are retained and checked against
  reported ledger balances with bounded per-asset precision tolerance; no fake
  balancing trades or arbitrary percentage rescaling is used.
- Opening/transferred inventory without an observed acquisition has **unknown
  cost and purchase date**. Transfer dates and current prices are never invented
  as entries. Material gaps, borrowing, ambiguities and wallet mismatches flag
  unconfirmed basis instead of manufacturing profit.
- Current wallet reconciliation prevents phantom open holdings. Purchase-lot
  quantities/cost remain precise; differences within venue reporting precision
  are distinguished from material missing inventory.
- Net P&L requires identifiable fees and purchase basis. Third-currency fees
  without historical conversion are not silently zeroed; any before-fee result
  is separately labelled and is not net profit.
- Summaries remain in native quote currency. USDT/USDC are not assumed equal to
  each other or fiat USD; different quote currencies are never added together.

Unrealized P&L is current bid value less remaining purchase cost, including known
paid purchase fees, **before future sale fees**. Realized spot P&L uses executed
net sale proceeds and matched purchase cost. Financing/loan interest, funding,
cash conversions and transfers are outside these spot-trading totals. Deposits
and account equity changes are not treated as profit. This is informational
portfolio bookkeeping, not a tax report or a cash-flow-adjusted account return.

The ledger contains account-wide spot executions. Following Bull Rotation does
not prove every exchange order came from that script; no automatic strategy
attribution or backtest/signal-date substitution is made.

## Display

The private view has three sections, scoped to BTC, SOL, SUI, DOGE, HYPE and ETH:
1. Current positive holdings: **unrealized gain/loss and percentage only**. No
   balance mirror, purchase-lot tables, account-wide totals or derivative panels.
2. Spot trades: newest **five orders** initially, with **Show 5 more** and
   **Show fewer**. Actual partial executions are still aggregated into orders.
3. Closed P&L percentage: **12 calendar months** by default, with **18/24-month**
   filters. The server sums realized net P&L and divides by the matched FIFO
   purchase cost of the sold units, times 100. This is a cost-weighted return on
   sold units, not a win rate, annualized return or cash-flow-adjusted account return.

Closed-return boundaries use individual sale-fill timestamps, so an order split
across a boundary is not incorrectly included in full. Known fees are included;
unknown purchase-cost/fee results are excluded and counted as sale **fills** (not
orders). Different quote currencies have separate percentages. Empty/unknown
results are unavailable, not zero. Partial date coverage is disclosed; expanding
the filter never invents earlier history. Normal refresh preserves the selected
period and trade-list length, while locking/expiry/concealment clears private data.
Underlying historical records are retained, including assets hidden by this view.

A first import can take multiple bounded calls. The UI retries through its normal
visible-page refresh; it cannot disclose data before server-side owner login.
Existing session, logout/expiry, no-store, CSP, service-worker and transient-state
privacy boundaries remain in place for the new endpoint.

## Operator import

To finish an initial import from the server without printing trades or keys:

```bash
cd /root/website
pnpm exec tsx scripts/sync_bybit_spot.ts
```

The bounded helper prints only progress/counts and generic errors, never trade
amounts or credentials. It does not submit orders, advance a paper account or
change the live trading script. API failures preserve completed checkpoints.

References:
- https://bybit-exchange.github.io/docs/v5/order/execution
- https://bybit-exchange.github.io/docs/v5/account/transaction-log
- https://bybit-exchange.github.io/docs/v5/market/instrument
- https://bybit-exchange.github.io/docs/v5/enum#spot-fee-currency-instruction
