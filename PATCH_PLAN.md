# Patch Plan

Goal: Align the website dashboard and portfolio with the live droplet strategy state and API.

## Scope
- Add a stable server-side live portfolio module and HTTP route.
- Ensure the portfolio page reads from the live route instead of stale local-only derived state.
- Add a lightweight live dashboard route and client-side consumption for key strategy metadata.
- Surface accurate timestamps and source metadata from droplet-backed files.
- Remove stale messaging that references deprecated /root paths.

## Working hypotheses
- The current repository lacks the live droplet integration files present on the droplet.
- The current frontend portfolio page is built around local/manual portfolio derivation rather than droplet truth.
- The home dashboard likely still depends on Binance-derived client calculations rather than live server snapshots.

## Next actions
1. Inspect Home.tsx and Portfolio.tsx more completely.
2. Implement new shared live-data server modules.
3. Patch client pages to fetch live JSON-backed routes.
4. Build locally and validate bundle contents.
