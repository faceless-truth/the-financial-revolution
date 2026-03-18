# Planning Patch Next Steps

## Goal
Add live planning-state calculations for Rule 3 / Rule 4 timing to the droplet-backed dashboard and portfolio.

## Remaining code changes

1. In `server/livePortfolio.ts`, add a `buildPlanningState(...)` helper that computes:
   - `currentBlocker`
   - `blockerList`
   - `btcRallyBlockActive`
   - `btcLatest30dHighDate`
   - `btcRallyBlockExpiresAfterCloseUtc`
   - `earliestEligibleRunUtc`
   - `candidateAsset`
   - `candidateScore`
   - `candidateRelativeStrengthPct`
   - `candidateDistanceTo30dHighPct`
   - `candidateBreakoutReady`
   - `rule4Status`
   - `nextActionSummary`

2. Attach `planning` to the server return payload alongside `summary`, `performance`, and `preparation`.

3. In `client/src/pages/Home.tsx`:
   - add `const planning = data?.planning;`
   - create a `PlanningCard` component
   - render the planning card near the main strategy summary panels.

4. In `client/src/pages/Portfolio.tsx`:
   - add `const planning = data?.planning;`
   - insert a `Rotation Readiness` panel above the candidate/source section.

## Validation
After patching:

```bash
cd /home/ubuntu/the-financial-revolution-work
pnpm build
```

Expected outcome: a successful build with live dashboard and portfolio surfaces ready to represent earliest rotation timing and blocker logic.
