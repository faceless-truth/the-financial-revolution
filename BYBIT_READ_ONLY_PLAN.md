# Bybit account tracking — agreed scope and security prerequisites

User-selected scope: **Spot/Unified balances and derivatives positions**. Funding
wallet excluded. **Implemented 2026-09-21:** credentials were configured in the
private server file and verified read-only; the protected account section is on
Detailed Portfolio. It uses separate server-side owner authentication, not the
legacy browser-only gate. See `BYBIT_READ_ONLY_SETUP.md` for setup and current
behavior. The original planning constraints below remain security requirements.
**Do not paste API credentials into chat, browser storage, frontend variables or Git.**

## Keep separate from the Testing tab

Testing compares two equal-start virtual accounts. A future Bybit view reports
actual account holdings and must be separate—not substituted for the paper
control, added onto paper balances, or fed into trading decisions.

## Production authentication must come first

Production builds `server/index.ts`, not the development `_core/index.ts`.
The current `PasswordGate.tsx` is client-side only: its remembered flag is not
server authorization. Do not add private account data to `/api/bull-rotation`,
`data/public`, the existing public strategy payload, or an unauthenticated API.

Existing password/OAuth modules are not ready to mount unchanged. The password
router needs its bootstrap/fallback secrets removed, cookie parsing and expiry
corrected, actual financial-route middleware, rate limiting, origin checks and
revocation. OAuth also needs explicit owner authorization, not just any logged-in
user. Choose and test a production owner-session design before enabling Bybit.

Every Bybit status/data/cache endpoint must enforce server-side owner access
first, with private/no-store responses. Anonymous, forged, expired or revoked
sessions must cause **zero Bybit calls**. A frontend remembered flag is insufficient.

## Server-only configuration

Use a secret manager or a restricted file outside both repositories and all
static paths, for example `/etc/crypto-dashboard/bybit-readonly.env`, owner-only
permissions. Do not create/overwrite an existing secret file without inspection
of its existence/permissions; never display its contents in tool output or logs.
No such file was created by the Testing-tab work.

- API key and secret remain on the server; no `VITE_` credential variables.
- IP-bind the key to the server's fixed egress address.
- Confirm the account's correct official regional API host. Use an exact HTTPS
  allowlist, no arbitrary URLs, no redirects, and no regional/geofence bypass.
- Disabled by default until authentication and configuration are complete.
- Use server-side HMAC signing, bounded timeouts/rate limits and safe clock handling.
- Never log keys, signatures, signing input, cookies, raw client configuration or
  raw Bybit error responses (some errors can include signing details).

## Read-only endpoints to validate

1. `GET /v5/user/query-api`: require explicit `readOnly === 1` before account calls.
   Do not forward the raw response; it includes API-key/account information.
2. `GET /v5/account/info`: identify account mode. Initial support should explicitly
   target UTA2 (`unifiedMarginStatus` 5/6); report legacy modes as unsupported or
   needing review, not as empty balances.
3. `GET /v5/account/wallet-balance?accountType=UNIFIED`.
4. `GET /v5/position/list?category=linear&settleCoin=USDT&limit=200`.
5. The same linear query for `settleCoin=USDC`.
6. `GET /v5/position/list?category=inverse&limit=200` for all open inverse positions.

Follow each position query's `nextPageCursor` fully, with repeat-cursor/page-limit
checks and explicit incomplete-coverage errors. Preserve hedge legs by category,
symbol and `positionIdx`. No orders, withdrawals, transfers, Funding-wallet calls
or options-position scope is requested. Permission metadata alone is not a full
minimum-permission matrix; check required read capabilities without requesting
write permissions as a workaround.

## Financial correctness

- Preserve decimal strings, units and liabilities; blanks/missing values are
  unavailable, not zero.
- Account-wide totals may not apply in isolated/portfolio-margin modes.
- Unified equity already reflects applicable derivative P&L. Never add position
  notional, posted margin or unrealized P&L on top as extra assets.
- Inverse values/P&L may be coin-denominated; do not sum mixed currencies.
- Respect current `spotBorrow`/wallet-balance semantics; gross balance is not
  automatically net ownership or freely spendable cash.
- Return observation time, completeness, and stale/error states. Failed requests
  must never look like a successfully empty account.

## Official references checked for planning

- https://bybit-exchange.github.io/docs/v5/guide
- https://bybit-exchange.github.io/docs/v5/account/wallet-balance
- https://bybit-exchange.github.io/docs/v5/account/account-info
- https://bybit-exchange.github.io/docs/v5/acct-mode
- https://bybit-exchange.github.io/docs/v5/position
- https://bybit-exchange.github.io/docs/v5/user/apikey-info

The current wallet documentation lists UNIFIED, while the account-mode guide
still describes older classic/UTA1 arrangements. Do not implement an obsolete
SPOT+UNIFIED query pattern without checking the actual account mode. The current
position docs allow inverse open-position queries without a symbol; the UTA2
restriction concerns multi-symbol queries. Recheck docs during implementation.
