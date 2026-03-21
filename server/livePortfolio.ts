import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/var/lib/crypto_dashboard";
const STATE_FILE = process.env.CRYPTO_DASHBOARD_STATE_FILE ?? path.join(DASHBOARD_ROOT, "optimized_trading_state.json");
const STRATEGY_FILE = process.env.CRYPTO_DASHBOARD_STRATEGY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_strategy_data.json");
const SIGNAL_HISTORY_FILE = process.env.CRYPTO_DASHBOARD_SIGNAL_HISTORY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_signal_history.json");
const ANALYTICS_FILE = process.env.CRYPTO_DASHBOARD_ANALYTICS_FILE ?? path.join(DASHBOARD_ROOT, "paleologo_analytics.json");
const SCENARIO_FILE = process.env.CRYPTO_DASHBOARD_SCENARIO_FILE ?? path.join(DASHBOARD_ROOT, "next_scenarios.json");
const FORECAST_FILE = process.env.CRYPTO_DASHBOARD_FORECAST_FILE ?? path.join(DASHBOARD_ROOT, "next_trade_forecast.json");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toDate(value: unknown) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDateUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function humanDateUtc(date: Date) {
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function getLatestHistoryRow(history: any[]) {
  return Array.isArray(history) && history.length ? history[history.length - 1] : null;
}

function inferDisplayedPortfolioValueUsd(state: any, analytics: any, strategy: any): number {
  return toNumber(
    state?.displayedPortfolioValueUsd ??
    state?.portfolio_value_usd ??
    analytics?.displayedPortfolioValueUsd ??
    analytics?.portfolio_value_usd ??
    strategy?.displayedPortfolioValueUsd ??
    71000,
    71000,
  );
}

function inferFixedCapitalUsd(state: any, analytics: any, strategy: any): number {
  return toNumber(
    state?.fixedCapitalUsd ??
    state?.fixed_capital_usd ??
    analytics?.fixedCapitalUsd ??
    strategy?.fixedCapitalUsd ??
    71000,
    71000,
  );
}

function inferLastUpdate(state: any, history: any[]): string {
  const lastHistory = getLatestHistoryRow(history);
  return asString(
    state?.last_update ??
    state?.lastUpdate ??
    lastHistory?.timestamp ??
    lastHistory?.date ??
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

function inferSignalAction(state: any, strategy: any, history: any[]): string {
  const lastHistory = getLatestHistoryRow(history);
  return asString(
    state?.signal_action ??
    state?.signalAction ??
    strategy?.signalAction ??
    strategy?.action ??
    lastHistory?.action ??
    "HOLD",
    "HOLD",
  );
}

function inferRuleReason(state: any, strategy: any, history: any[]): string {
  const lastHistory = getLatestHistoryRow(history);
  return asString(
    state?.reason ??
    state?.rule_reason ??
    strategy?.reason ??
    lastHistory?.reason ??
    lastHistory?.ruleReason ??
    "Live droplet mirror",
    "Live droplet mirror",
  );
}

function inferCurrentAsset(state: any, history: any[]): string {
  const direct = asString(state?.current_asset ?? state?.currentAsset ?? state?.current_position ?? "", "");
  if (direct) return direct;

  const lastHistory = getLatestHistoryRow(history);
  const positions = lastHistory?.target_positions ?? lastHistory?.current_positions ?? {};
  if (positions && typeof positions === "object") {
    const firstKey = Object.keys(positions).find((key) => toNumber((positions as any)[key], 0) > 0);
    if (firstKey) return firstKey;
  }
  if (lastHistory?.in_cash === true) return "CASH";
  return "CASH";
}

function inferTopCandidates(strategy: any, history: any[]): Array<{ asset: string; score: number }> {
  const direct = Array.isArray(strategy?.topCandidates)
    ? strategy.topCandidates
    : Array.isArray(strategy?.momentumRanked)
      ? strategy.momentumRanked
      : [];

  const normalizedDirect = direct
    .map((row: any) => ({
      asset: asString(row?.asset ?? row?.symbol ?? "", ""),
      score: toNumber(row?.score ?? row?.momentum ?? row?.value ?? 0, 0),
    }))
    .filter((row: any) => row.asset);

  if (normalizedDirect.length > 0) {
    return normalizedDirect.sort((a, b) => b.score - a.score);
  }

  for (const row of [...history].reverse()) {
    const scores = row?.momentum_scores;
    if (scores && typeof scores === "object") {
      const ranked = Object.entries(scores)
        .map(([asset, score]) => ({ asset, score: toNumber(score, 0) }))
        .sort((a, b) => b.score - a.score);
      if (ranked.length > 0) return ranked;
    }
  }

  return [];
}

function inferCandidateAsset(strategy: any, topCandidates: any[], history: any[]) {
  const direct = asString(strategy?.topAsset ?? strategy?.targetAsset ?? strategy?.candidateAsset ?? "", "");
  if (direct) return direct;

  const historyTop = [...history].reverse().map((row) => asString(row?.top_asset ?? row?.topAsset ?? "", "")).find(Boolean);
  if (historyTop) return historyTop;

  if (Array.isArray(topCandidates) && topCandidates.length) {
    return asString(topCandidates[0]?.asset ?? topCandidates[0]?.symbol ?? "", "");
  }
  return "";
}

function inferLatestThirtyDayHighDate(state: any, strategy: any, history: any[]) {
  const candidates = [
    state?.latest_30d_high_date,
    state?.latest30dHighDate,
    state?.btc_latest_30d_high_date,
    state?.btcLatest30dHighDate,
    strategy?.latest30dHighDate,
    strategy?.latest_30d_high_date,
    strategy?.btcLatest30dHighDate,
    strategy?.btc_latest_30d_high_date,
    strategy?.rallyBlock?.latest30dHighDate,
    strategy?.rally_block?.latest_30d_high_date,
  ];
  for (const value of candidates) {
    const d = toDate(value);
    if (d) return d;
  }
  if (Array.isArray(history)) {
    for (const row of [...history].reverse()) {
      const reason = String(row?.reason ?? row?.ruleReason ?? row?.notes ?? "");
      if (/new\s+30d\s+high|30d\s+high/i.test(reason)) {
        const d = toDate(row?.timestamp ?? row?.date);
        if (d) return d;
      }
    }
  }
  return null;
}

function inferRule4Readiness(strategy: any, scenarios: any, history: any[]) {
  const values = [
    strategy?.rule4Pass,
    strategy?.rule4Passed,
    strategy?.rule4?.passed,
    strategy?.breakoutConfirmationPassed,
    strategy?.breakout_confirmation_passed,
    strategy?.preparation?.rule4Passed,
    strategy?.preparation?.breakoutReady,
    scenarios?.rule4Pass,
    scenarios?.rule4Passed,
  ];
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }

  const latestHistory = getLatestHistoryRow(history);
  const latestReason = asString(latestHistory?.reason ?? latestHistory?.ruleReason ?? "", "");
  if (/rule\s*4/i.test(latestReason) && /need|pending|block|fail|failed/i.test(latestReason)) return false;
  if (/rule\s*4/i.test(latestReason) && /pass|passed|ready/i.test(latestReason)) return true;

  const textCandidates = [
    asString(strategy?.preparation?.note ?? "", ""),
    asString(strategy?.reason ?? "", ""),
    asString(scenarios?.summary ?? "", ""),
  ].join(" ");
  if (/rule\s*4/i.test(textCandidates) && /pass|passed|ready/i.test(textCandidates)) return true;
  if (/rule\s*4/i.test(textCandidates) && /fail|failed|block/i.test(textCandidates)) return false;
  return null;
}

function computePlanningState(state: any, strategy: any, history: any[], scenarios: any, topCandidates: any[]) {
  const currentAsset = inferCurrentAsset(state, history);
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const candidateAsset = inferCandidateAsset(strategy, topCandidates, history);
  const latestHighDate = inferLatestThirtyDayHighDate(state, strategy, history);
  const latestHighDateIso = latestHighDate ? formatDateUtc(latestHighDate) : "";
  const currentRuleReason = inferRuleReason(state, strategy, history);
  const latestHistory = getLatestHistoryRow(history);
  const latestHistoryReason = asString(latestHistory?.reason ?? latestHistory?.ruleReason ?? "", "");
  const effectiveReason = `${currentRuleReason} ${latestHistoryReason}`.trim();
  const rule3Active = /rule\s*3|30d\s+high|new\s+30d\s+high/i.test(effectiveReason);
  const rule2Active = /rule\s*2|minimum\s+hold|held\s+\d+\/7|7-day\s+minimum/i.test(effectiveReason);
  const rule4Ready = inferRule4Readiness(strategy, scenarios, history);
  const blockExpiresAfterCloseUtc = latestHighDate ? addDays(latestHighDate, 2) : null;
  const earliestEligibleRunUtc = latestHighDate ? addDays(latestHighDate, 3) : null;

  let currentBlocker = "Monitoring for next eligible rotation window";
  if (rule2Active) currentBlocker = "Rule 2: 7-day minimum hold still active";
  else if (rule3Active) currentBlocker = "Rule 3: BTC rally block active until the post-close window clears";
  else if (rule4Ready === false) currentBlocker = "Rule 4: target asset breakout confirmation not yet satisfied";

  let nextActionSummary = currentBlocker;
  if (rule3Active && earliestEligibleRunUtc && candidateAsset) {
    nextActionSummary = `Earliest possible rotation into ${candidateAsset} is ${humanDateUtc(earliestEligibleRunUtc)} UTC, provided BTC does not print another 30d high before then and Rule 4 passes.`;
  } else if (rule2Active && candidateAsset) {
    nextActionSummary = `Hold discipline remains active; ${candidateAsset} cannot rotate in until the minimum hold window clears.`;
  } else if (rule4Ready === false && candidateAsset) {
    nextActionSummary = `${candidateAsset} is the leading candidate, but Rule 4 breakout confirmation still needs to pass.`;
  } else if (candidateAsset) {
    nextActionSummary = `${candidateAsset} is currently the leading candidate if all rotation gates remain clear.`;
  }

  return {
    currentBlocker,
    rule2Active,
    rule3Active,
    rule4Ready,
    latestThirtyDayHighDateUtc: latestHighDateIso,
    blockExpiresAfterCloseUtc: blockExpiresAfterCloseUtc ? blockExpiresAfterCloseUtc.toISOString() : "",
    earliestEligibleRunUtc: earliestEligibleRunUtc ? earliestEligibleRunUtc.toISOString() : "",
    earliestEligibleRunLabel: earliestEligibleRunUtc ? humanDateUtc(earliestEligibleRunUtc) : "Watching next close",
    candidateAsset,
    currentAsset,
    holdDays,
    nextActionSummary,
  };
}

function deriveLiveCounters(state: any) {
  return {
    trades: toNumber(state?.trades ?? state?.trade_count ?? 0, 0),
    rotations: toNumber(state?.rotations ?? state?.rotation_count ?? 0, 0),
    cashExits: toNumber(state?.cash_exits ?? state?.cashExits ?? 0, 0),
    allNegativeExits: toNumber(state?.all_neg_exits ?? state?.allNegativeExits ?? 0, 0),
    allNegativeBlocked: toNumber(state?.all_neg_blocked ?? state?.allNegativeBlocked ?? 0, 0),
    rule2Blocks: toNumber(state?.rule2_blocks ?? 0, 0),
    rule3Blocks: toNumber(state?.rule3_blocks ?? 0, 0),
    rule3ForceBtc: toNumber(state?.rule3_force_btc ?? state?.rule3ForceBtc ?? 0, 0),
    rule4Blocks: toNumber(state?.rule4_blocks ?? 0, 0),
  };
}

function buildForecastFromLiveData(snapshot: any) {
  const ranking = Array.isArray(snapshot.preparation?.topCandidates) ? snapshot.preparation.topCandidates : [];
  const planning = snapshot.planning ?? {};
  const status = snapshot.summary ?? {};
  const currentAsset = status.currentAsset ?? "CASH";
  const breakoutPrice = snapshot.raw?.scenarios?.breakoutPrice ?? snapshot.raw?.strategy?.breakoutPrice ?? null;
  const currentPrice = snapshot.raw?.scenarios?.currentPrice ?? null;
  const thirtyDayHigh = snapshot.raw?.scenarios?.thirtyDayHigh ?? null;
  const conditionsNeeded = planning.rule4Ready === false && ranking[0]?.asset
    ? [
        `${ranking[0].asset} must close above ${breakoutPrice ? `$${Number(breakoutPrice).toFixed(2)}` : 'its breakout threshold'}${currentPrice ? ` (currently $${Number(currentPrice).toFixed(2)}` : ''}${thirtyDayHigh ? `, 30d high $${Number(thirtyDayHigh).toFixed(2)}` : ''}${currentPrice ? ')' : ''}.`,
      ]
    : planning.rule3Active
      ? ["BTC must avoid printing another 30-day high during the rally-block window."]
      : planning.rule2Active
        ? [`Continue holding ${currentAsset} until the 7-day minimum hold period clears.`]
        : [];

  const forwardOutlook = Array.from({ length: 7 }).map((_, index) => {
    const day = index + 1;
    const dateBase = planning.earliestEligibleRunUtc ? new Date(planning.earliestEligibleRunUtc) : addDays(new Date(), day);
    const date = planning.earliestEligibleRunUtc ? addDays(dateBase, index) : dateBase;
    let note = "No change — same blockers remain";
    if (!planning.rule2Active && !planning.rule3Active && planning.rule4Ready !== false) {
      note = "All key gates appear clear — trade remains possible if leadership holds";
    } else if (planning.rule3Active && planning.earliestEligibleRunLabel && day === 1) {
      note = `Rule 3 may clear around ${planning.earliestEligibleRunLabel} if BTC avoids another 30d high.`;
    } else if (planning.rule2Active && day === 1) {
      note = "Rule 2 is the nearest blocker to clear as hold days continue to accrue.";
    } else if (planning.rule4Ready === false) {
      note = `${planning.candidateAsset ?? ranking[0]?.asset ?? 'Leader'} still needs breakout confirmation.`;
    }
    return {
      day,
      dateUtc: formatDateUtc(date),
      label: humanDateUtc(date),
      notes: [note],
    };
  });

  return {
    generatedAtUtc: status.lastUpdate ?? new Date().toISOString(),
    sourceMode: "inferred_from_live_data",
    currentPosition: {
      asset: currentAsset,
      allocation: currentAsset === "CASH" ? 0 : 1,
      holdDays: toNumber(status.holdDays ?? 0, 0),
      entryPrice: toNumber(status.entryPrice ?? 0, 0),
      entryDate: asString(status.entryDate ?? "", ""),
      portfolioValueUsd: toNumber(status.displayedPortfolioValueUsd ?? 0, 0),
    },
    momentumRanking: ranking,
    btcHealth: {
      latestThirtyDayHighDateUtc: planning.latestThirtyDayHighDateUtc ?? "",
      blockExpiresAfterCloseUtc: planning.blockExpiresAfterCloseUtc ?? "",
      rule3Active: planning.rule3Active ?? false,
    },
    confidence: {
      score: toNumber(snapshot.raw?.analytics?.confidenceScore ?? snapshot.raw?.strategy?.confidenceScore ?? 0, 0),
      label: asString(snapshot.raw?.analytics?.confidenceLabel ?? snapshot.raw?.strategy?.confidenceLabel ?? "Unknown", "Unknown"),
      fearGreedValue: toNumber(snapshot.raw?.analytics?.fearGreedValue ?? snapshot.raw?.strategy?.fearGreedValue ?? 0, 0),
      fearGreedAverage: toNumber(snapshot.raw?.analytics?.fearGreedAverage ?? snapshot.raw?.strategy?.fearGreedAverage ?? 0, 0),
    },
    rules: {
      rule2Active: planning.rule2Active ?? false,
      rule3Active: planning.rule3Active ?? false,
      rule4Ready: planning.rule4Ready ?? null,
      currentBlocker: planning.currentBlocker ?? "Monitoring live conditions",
    },
    nextTrade: {
      actionIfRunNow: status.signalAction ?? "HOLD",
      targetAsset: planning.candidateAsset ?? ranking[0]?.asset ?? "",
      reason: status.ruleReason ?? planning.currentBlocker ?? "Live mirror",
      conditionsNeeded,
    },
    forwardOutlook,
  };
}

export async function getLivePortfolioData() {
  const [state, strategy, history, analytics, scenarios] = await Promise.all([
    readJson<any>(STATE_FILE, {}),
    readJson<any>(STRATEGY_FILE, {}),
    readJson<any[]>(SIGNAL_HISTORY_FILE, []),
    readJson<any>(ANALYTICS_FILE, {}),
    readJson<any>(SCENARIO_FILE, {}),
  ]);

  const displayedPortfolioValueUsd = inferDisplayedPortfolioValueUsd(state, analytics, strategy);
  const fixedCapitalUsd = inferFixedCapitalUsd(state, analytics, strategy);
  const pnlUsd = displayedPortfolioValueUsd - fixedCapitalUsd;
  const totalReturnPct = fixedCapitalUsd > 0 ? (pnlUsd / fixedCapitalUsd) * 100 : 0;
  const lastUpdate = inferLastUpdate(state, history);
  const currentAsset = inferCurrentAsset(state, history);
  const signalAction = inferSignalAction(state, strategy, history);
  const marketRegime = asString(strategy?.marketRegime ?? strategy?.market_regime ?? analytics?.marketRegime ?? "LIVE", "LIVE");
  const ruleReason = inferRuleReason(state, strategy, history);
  const regimeConfidence = asString(strategy?.regimeConfidence ?? strategy?.confidence ?? analytics?.confidenceLabel ?? "—", "—");
  const confidenceLabel = asString(strategy?.confidenceLabel ?? analytics?.confidenceLabel ?? "Live", "Live");
  const liveStrategyValueUsd = toNumber(state?.liveStrategyValueUsd ?? state?.live_strategy_value_usd ?? analytics?.liveStrategyValueUsd ?? displayedPortfolioValueUsd, displayedPortfolioValueUsd);
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const entryPrice = toNumber(state?.entry_price ?? state?.entryPrice ?? 0, 0);
  const entryDate = asString(state?.entry_date ?? state?.entryDate ?? "", "");
  const topCandidates = inferTopCandidates(strategy, history);
  const planning = computePlanningState(state, strategy, history, scenarios, topCandidates);

  return {
    source: {
      root: DASHBOARD_ROOT,
      files: {
        state: STATE_FILE,
        strategy: STRATEGY_FILE,
        signalHistory: SIGNAL_HISTORY_FILE,
        analytics: ANALYTICS_FILE,
        scenarios: SCENARIO_FILE,
        forecast: FORECAST_FILE,
      },
    },
    summary: {
      fixedCapitalUsd,
      displayedPortfolioValueUsd,
      liveStrategyValueUsd,
      pnlUsd,
      totalReturnPct,
      currentAsset,
      signalAction,
      ruleReason,
      marketRegime,
      regimeConfidence,
      confidenceLabel,
      lastUpdate,
      holdDays,
      entryPrice,
      entryDate,
    },
    performance: {
      btcHoldValueUsd: toNumber(analytics?.btcHoldValueUsd ?? analytics?.btc_hold_value_usd ?? 0, 0),
      outperformanceUsd: toNumber(analytics?.outperformanceUsd ?? analytics?.outperformance_usd ?? 0, 0),
      outperformancePct: toNumber(analytics?.outperformancePct ?? analytics?.outperformance_pct ?? 0, 0),
      unrealisedPnlUsd: toNumber(state?.unrealisedPnlUsd ?? state?.unrealised_pnl_usd ?? 0, 0),
      unrealisedPnlPct: toNumber(state?.unrealisedPnlPct ?? state?.unrealised_pnl_pct ?? 0, 0),
      counters: deriveLiveCounters(state),
    },
    preparation: {
      readiness: asString(strategy?.readiness ?? strategy?.preparation?.readiness ?? "WATCH", "WATCH"),
      label: asString(strategy?.preparation?.label ?? strategy?.readiness ?? "Watch", "Watch"),
      note: asString(strategy?.preparation?.note ?? strategy?.reason ?? ruleReason, ruleReason),
      targetAsset: inferCandidateAsset(strategy, topCandidates, history),
      topCandidates,
      scenario: scenarios ?? {},
    },
    planning,
    tradeHistory: Array.isArray(history) ? history.slice(-50).reverse() : [],
    raw: {
      state,
      strategy,
      analytics,
      scenarios,
    },
  };
}

export async function getForecastData() {
  const snapshot = await getLivePortfolioData();
  const directForecast = await readJson<any>(FORECAST_FILE, null);
  if (directForecast && typeof directForecast === "object" && Object.keys(directForecast).length > 0) {
    return {
      ...directForecast,
      sourceMode: "forecast_file",
      sourceFile: FORECAST_FILE,
    };
  }

  return {
    ...buildForecastFromLiveData(snapshot),
    sourceFile: FORECAST_FILE,
  };
}

export async function getLiveDashboardData() {
  const [snapshot, forecast] = await Promise.all([
    getLivePortfolioData(),
    getForecastData(),
  ]);

  const topCandidates = Array.isArray(snapshot.preparation.topCandidates) ? snapshot.preparation.topCandidates : [];

  return {
    liveStrategy: {
      status: {
        currentPosition: snapshot.summary.currentAsset,
        signalAction: snapshot.summary.signalAction,
        holdDays: snapshot.summary.holdDays,
        entryPrice: snapshot.summary.entryPrice,
        entryDate: snapshot.summary.entryDate,
        lastUpdate: snapshot.summary.lastUpdate,
        ruleReason: snapshot.summary.ruleReason,
        displayedPortfolioValueUsd: snapshot.summary.displayedPortfolioValueUsd,
        fixedCapitalUsd: snapshot.summary.fixedCapitalUsd,
      },
      performance: snapshot.performance,
      preparation: snapshot.preparation,
      planning: snapshot.planning,
      tradeHistory: snapshot.tradeHistory,
      ranking: topCandidates,
    },
    forecast,
    source: snapshot.source,
    refresh: {
      pollingMs: 5 * 60 * 1000,
      dailyCloseUtc: "00:05",
      lastSuccessfulUpdateUtc: snapshot.summary.lastUpdate,
    },
    legacy: {
      status: {
        currentPosition: snapshot.summary.currentAsset,
        signalAction: snapshot.summary.signalAction,
        holdDays: snapshot.summary.holdDays,
        entryPrice: snapshot.summary.entryPrice,
        entryDate: snapshot.summary.entryDate,
        lastUpdate: snapshot.summary.lastUpdate,
        ruleReason: snapshot.summary.ruleReason,
        displayedPortfolioValueUsd: snapshot.summary.displayedPortfolioValueUsd,
        fixedCapitalUsd: snapshot.summary.fixedCapitalUsd,
      },
      ranking: topCandidates,
      preparation: snapshot.preparation,
      planning: snapshot.planning,
      tradeHistory: snapshot.tradeHistory,
    },
  };
}
