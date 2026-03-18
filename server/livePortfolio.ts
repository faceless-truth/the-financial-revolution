import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/var/lib/crypto_dashboard";
const STATE_FILE = process.env.CRYPTO_DASHBOARD_STATE_FILE ?? path.join(DASHBOARD_ROOT, "optimized_trading_state.json");
const STRATEGY_FILE = process.env.CRYPTO_DASHBOARD_STRATEGY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_strategy_data.json");
const SIGNAL_HISTORY_FILE = process.env.CRYPTO_DASHBOARD_SIGNAL_HISTORY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_signal_history.json");
const ANALYTICS_FILE = process.env.CRYPTO_DASHBOARD_ANALYTICS_FILE ?? path.join(DASHBOARD_ROOT, "paleologo_analytics.json");
const SCENARIO_FILE = process.env.CRYPTO_DASHBOARD_SCENARIO_FILE ?? path.join(DASHBOARD_ROOT, "next_scenarios.json");

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
  const lastHistory = history.length ? history[history.length - 1] : null;
  return asString(
    state?.last_update ??
    state?.lastUpdate ??
    lastHistory?.timestamp ??
    lastHistory?.date ??
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

function toDate(value: any) {
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
function inferCandidateAsset(strategy: any, topCandidates: any[]) {
  const direct = asString(strategy?.topAsset ?? strategy?.targetAsset ?? strategy?.candidateAsset ?? "", "");
  if (direct) return direct;
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
function inferRule4Readiness(strategy: any, scenarios: any) {
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
  const currentAsset = asString(state?.current_asset ?? state?.currentAsset ?? state?.current_position ?? "CASH", "CASH");
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const candidateAsset = inferCandidateAsset(strategy, topCandidates);
  const latestHighDate = inferLatestThirtyDayHighDate(state, strategy, history);
  const latestHighDateIso = latestHighDate ? formatDateUtc(latestHighDate) : "";
  const currentRuleReason = asString(state?.reason ?? state?.rule_reason ?? strategy?.reason ?? "", "");
  const rule3Active = /rule\s*3|30d\s+high|new\s+30d\s+high/i.test(currentRuleReason);
  const rule2Active = /rule\s*2|minimum\s+hold|hold\s*days|7-day\s+minimum/i.test(currentRuleReason);
  const rule4Ready = inferRule4Readiness(strategy, scenarios);
  const earliestEligibleRunUtc = latestHighDate ? addDays(latestHighDate, 4) : null;
  const blockExpiresAfterCloseUtc = latestHighDate ? addDays(latestHighDate, 3) : null;
  let currentBlocker = "Monitoring for next eligible rotation window";
  if (rule2Active) currentBlocker = "Rule 2: 7-day minimum hold still active";
  else if (rule3Active) currentBlocker = "Rule 3: BTC new 30d high still inside 3-candle window";
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
  const currentAsset = asString(state?.current_asset ?? state?.currentPosition ?? state?.current_position ?? "CASH", "CASH");
  const signalAction = asString(state?.signal_action ?? state?.signalAction ?? strategy?.signalAction ?? strategy?.action ?? "HOLD", "HOLD");
  const marketRegime = asString(strategy?.marketRegime ?? strategy?.market_regime ?? analytics?.marketRegime ?? "LIVE", "LIVE");
  const ruleReason = asString(state?.reason ?? state?.rule_reason ?? strategy?.reason ?? "Live droplet mirror", "Live droplet mirror");
  const regimeConfidence = asString(strategy?.regimeConfidence ?? strategy?.confidence ?? analytics?.confidenceLabel ?? "—", "—");
  const confidenceLabel = asString(strategy?.confidenceLabel ?? analytics?.confidenceLabel ?? "Live", "Live");
  const liveStrategyValueUsd = toNumber(state?.liveStrategyValueUsd ?? state?.live_strategy_value_usd ?? analytics?.liveStrategyValueUsd ?? displayedPortfolioValueUsd, displayedPortfolioValueUsd);
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const entryPrice = toNumber(state?.entry_price ?? state?.entryPrice ?? 0, 0);
  const entryDate = asString(state?.entry_date ?? state?.entryDate ?? "", "");
  const topCandidates = Array.isArray(strategy?.topCandidates)
    ? strategy.topCandidates
    : Array.isArray(strategy?.momentumRanked)
      ? strategy.momentumRanked
      : [];

  return {
    source: {
      root: DASHBOARD_ROOT,
      files: {
        state: STATE_FILE,
        strategy: STRATEGY_FILE,
        signalHistory: SIGNAL_HISTORY_FILE,
        analytics: ANALYTICS_FILE,
        scenarios: SCENARIO_FILE,
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
    },
    preparation: {
      readiness: asString(strategy?.readiness ?? strategy?.preparation?.readiness ?? "WATCH", "WATCH"),
      label: asString(strategy?.preparation?.label ?? strategy?.readiness ?? "Watch", "Watch"),
      note: asString(strategy?.preparation?.note ?? strategy?.reason ?? ruleReason, ruleReason),
      targetAsset: asString(strategy?.topAsset ?? strategy?.targetAsset ?? "", ""),
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

export async function getLiveDashboardData() {
  const snapshot = await getLivePortfolioData();
  const topCandidates = Array.isArray(snapshot.preparation.topCandidates) ? snapshot.preparation.topCandidates : [];
  return {
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
    source: snapshot.source,
  };
}
