# Private Bybit account view

The read-only connector is implemented for **Spot/Unified balances and linear /
inverse derivatives positions**. Funding-wallet and options-position queries
are excluded. Account data is separate from the strategy model and paper Testing.
No order, transfer, withdrawal or leverage-changing API is implemented.

## Deployment verification (2026-09-21)

The server-side connection accepted the supplied credentials and verified
read-only UTA2 access. The account section and protected API were deployed.
**The separate owner-password file was not yet present at verification**, so the
public session check correctly reports unauthenticated/not configured and the
account endpoint returns 401. Follow the password setup below to view balances.

All **222 website tests passed**, plus the production authentication/header checks.
A local browser fixture verified login/display/locking behavior and mobile layout;
no real private-owner login or real-account screenshot was performed. A server-side
scan confirmed that neither supplied credential appears in the public build.

## Where to see it

Open **Detailed Portfolio** (`/portfolio`) and use the section near the top:
**Investment portfolio — Bybit spot**.

The main view now reports actual purchases, sales, FIFO purchase cost and current
unrealized/realized trading P&L—not just a wallet-balance mirror. See
`BYBIT_SPOT_PERFORMANCE.md` for accounting, fees, coverage and unknown-basis rules.
The unlocked view shows only the six selected assets' current unrealized P&L,
five recent spot orders with Show more, and a 12-/18-/24-month closed-return
percentage. The earlier balance/derivatives display is no longer mounted.

The normal website login is unchanged. Exchange data additionally requires a
**server-verified private account password**, not the client-side remembered gate
and not the Bybit API secret. Until that password is configured, the card remains
locked with a setup message; it never substitutes model balances for an account.

## Server-only setup

The user supplied credentials in:

```text
/etc/crypto-dashboard/bybit-readonly.env
```

Expected fields (never paste real values into chat or Git):

```env
BYBIT_API_KEY="..."
BYBIT_API_SECRET="..."
```

The file must be regular, owned by root/the server user, and have no group/world
permissions. The loader refuses symlinks, oversized files, changed-during-read
files, blank/placeholders and unapproved API hosts. Credentials are loaded lazily
on an authorized account request, not included in the frontend or public JSON.

Create the separate private-view password in an **interactive SSH terminal**:

```bash
sudo python3 /root/website/scripts/setup_bybit_owner.py
```

The prompt requires a new 12–256-character password and confirmation. Input is
hidden; pipes/password arguments are refused. Do not use an API credential as
this password. The script writes only a salted scrypt verifier to:

```text
/etc/crypto-dashboard/bybit-owner-auth.json
```

Both files should be mode 600 inside an owner-only directory. The verifier is
not a plaintext password. Initialization refuses to overwrite an existing
password file. To deliberately change it and revoke existing private sessions:

```bash
sudo python3 /root/website/scripts/setup_bybit_owner.py --rotate
```

No application restart is required for password configuration/rotation. Refresh
the portfolio page or click **Recheck secure login setup**, then unlock with the
private password. Never enter the API key or secret into the browser.

## Connection and permissions

The server accepts only fixed GET paths on explicitly allowlisted official
mainnet origins. Default is `https://api.bybit.com`; an administrator may set
`BYBIT_API_BASE_URL` in the private credential file for the correct documented
region. There is no automatic regional failover, redirect following or attempt
to bypass IP/geographic restrictions.

Collection order is server time, API-key information, account mode, Unified
wallet and the three position scopes. `readOnly === 1` is mandatory before any
account/financial request. Initial supported modes are UTA2 status 5/6; older
modes fail explicitly rather than silently omit inverse collateral. The supplied
connection was verified as read-only/UTA2 during setup; no balances or keys were
written to public artifacts during verification.

Restrict the key to the server's fixed public egress IP in Bybit API settings.
The UI warns if an IP restriction is absent or cannot be verified. Keep trading
and withdrawals disabled. No actual account identifier or raw API-key-info
response is exposed by the connector.

## Privacy boundaries

- New routes are mounted on the **production** `server/index.ts`, before the
  public JSON parser and SPA/static fallback. The old development password/tRPC
  modules are not reused or treated as authorization.
- `/api/bybit/session` returns only owner-login readiness/authentication booleans.
- `/api/bybit/login` verifies the private scrypt record, then sets a random opaque
  8-hour, absolute-expiry `__Host-` session cookie: HttpOnly, Secure, SameSite Strict,
  Path `/`, no Domain. Only token hashes are retained in bounded server memory.
- `/api/bybit/account` validates the owner session before invoking the connector
  and rechecks after collection. Anonymous, forged, expired or revoked sessions
  cannot trigger account-data calls. The old browser remember flag is irrelevant.
- `/api/bybit/logout` revokes the session. Password-file changes invalidate all
  sessions; server restarts also clear them. Login/logout require an exact allowed
  Origin; login attempts are rate-limited per IP and globally.
- HTTPS is mandatory; Express trusts only the loopback nginx proxy. Private API
  responses are `private, no-store`, vary by Cookie and are fetch-only, not
  navigable documents. Noncanonical path aliases fail closed.
- Production session-replay/debug injection and the old analytics placeholder were
  removed. Production CSP restricts scripts to self and prevents framing. Optional
  local dev diagnostics must never be used with real private account data.
- The service worker excludes all private Bybit requests from caching/offline
  fallback, rejects private/no-store responses from generic caching, and purges
  its older cache version.
- Current account snapshots use server memory (30-second freshness cache) and
  transient component state. Actual spot executions/inventory movements are
  retained in an account-bound private archive outside the website/Git, mode 600
  inside a mode-700 directory, so purchase history is not lost as API retention
  rolls forward. Neither snapshots nor history are added to `data/public`, paper
  files, public strategy endpoints, browser storage, push notifications or trading
  inputs. The client clears both performance and diagnostic views on hiding,
  locking or expiry and guards in-flight responses.

Existing site visitors can still view the original strategy/paper pages using
their normal website gate. That does not grant access to this private account.

## Financial interpretation and failure behavior

Unified equity, wallet balance, perpetual unrealized P&L and available margin
are **Bybit-reported aggregates**. Do not add position notional, margin or P&L to
Unified equity. Coin balances can include borrow/liability semantics and are not
a promise of freely withdrawable funds. Funding wallet and other subaccounts are
not included; the view reflects the account linked to this API key.

Decimal strings are preserved. Missing/blank totals, leverage or liquidation
prices display as unavailable, never fabricated zero. Inverse/native-currency
P&L is not summed into USD. Hedge legs remain separate by category, symbol and
position index. Each of USDT linear, USDC linear and inverse pagination is checked
for completion; a failed/malformed scope is labelled partial instead of an empty
account. Options positions are not listed even if their value affects equity.

The page refreshes every 60 seconds while visible. Collection timestamps are
shown. HTTP/API failures clear the view rather than present stale values as a
fresh or empty account. Error messages are fixed local text: API keys, signatures,
signing inputs, cookies, raw vendor error bodies and financial responses are not
logged. Market observations are not proof of executed fills or investment returns.

## Tests and deployment

- `server/bybitReadOnly.test.ts`: fake credentials/transport and mocked filesystem;
  HMAC, permissions, pagination, decimals, redaction and cache invalidation.
- `server/bybitRoutes.test.ts`: real local HTTP with temporary fake auth records;
  owner authorization, cookies, expiry/revocation, origin checks and rate limits.
- `server/bybitAccountView.test.ts`: synthetic display fixtures and privacy guards.
- `server/bybitPrivacy.test.ts`: Python/Node scrypt compatibility, private navigation
  and service-worker cache boundaries, production route/telemetry wiring.

Build/check with `pnpm check`, `pnpm test`, `pnpm build`. Deploy only the
`financial-revolution` PM2 app, preserving its launch environment. Never restart
unrelated trading services or copy a real account snapshot into frontend fixtures.
