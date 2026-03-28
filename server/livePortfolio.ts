/**
 * BULL_ROTATE v2.0 + Regime Soft Gate + Profit Cash-Out — Server Data Adapter
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads state files written by the bull_rotate.py script on the droplet
 * and exposes clean, typed snapshots to the frontend via /api/live-dashboard
 * and /api/live-portfolio endpoints.
 *
 * Expected files (all under CRYPTO_DASHBOARD_ROOT):
 *   bull_rotate_state.json   — latest strategy state written by Python script
 *   bull_rotate_history.json — rolling 100-record trade history
 *
 * New fields in v2.0 + Regime + Cash-Out:
 *   state.reserve_usd        — accumulated profit cash-out reserve
 *   state.total_wealth_usd   — portfolio + reserve combined
 *   market_data.BTC.regime_conf — BTC regime confidence (0-100)
 *   history[].cashout_amount — amount cashed out on that trade
 *   history[].regime_conf    — regime confidence at time of trade
 */

import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/root/crypto_dashboard";
const STATE_FILE     = process.env.BULL_ROTATE_STATE_FILE   ?? path.join(DASHBOARD_ROOT, "bull_rotate_state.json");
const HISTORY_FILE   = process.env.BULL_ROTATE_HISTORY_FILE ?? path.join(DASHBOARD_ROOT, "bull_rotate_history.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Asset metadata ────────────────────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC:  "oklch(0.78 0.18 75)",
  ETH:  "oklch(0.65 0.18 255)",
  SOL:  "oklch(0.72 0.20 310)",
  DOGE: "oklch(0.82 0.18 95)",
  SUI:  "oklch(0.68 0.20 220)",
  CASH: "oklch(0.55 0.010 260)",
};

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", DOGE: "Ð", SUI: "◆", CASH: "$",
};

// ── Derive human-readable status from action code ────────────────────────────

function describeAction(action: string, position: string, reason: string): string {
  switch (action) {
    case "CRASH_EXIT":   return `Exited to CASH — BTC 30d drawdown hit -25% crash threshold`;
    case "REENTER_BTC":  return `Re-entered BTC — 30d momentum turned positive`;
    case "STOP_CASH":    return `BTC hit -15% stop loss — moved to CASH`;
    case "STOP_TO_BTC":  return `${position} hit -15% stop loss — rotated back to BTC`;
    case "ROTATE":       return reason || `Rotated into ${position}`;
    case "HOLD_MIN":     return `Holding — 3-day minimum hold active`;
    case "HOLD_CASH":    return `Holding CASH — BTC 30d momentum still negative`;
    case "HOLD":         return reason || `Holding ${position}`;
    default:             return reason || action;
  }
}

// ── Derive rotation readiness ─────────────────────────────────────────────────

function deriveReadiness(state: any, history: any[]): {
  status: string;
  label: string;
  note: string;
  blocker: string | null;
} {
  const action   = asString(state?.action, "HOLD");
  const position = asString(state?.current_position, "CASH");
  const holdDays = toNumber(state?.hold_days, 0);
  const mktData  = state?.market_data ?? {};
  const btcScore = toNumber(mktData?.BTC?.score, 0);

  // Compute best alt score
  let bestAlt = "";
  let bestAltScore = -Infinity;
  for (const [asset, data] of Object.entries(mktData) as [string, any][]) {
    if (asset !== "BTC" && toNumber(data?.score, 0) > bestAltScore) {
      bestAltScore = toNumber(data?.score, 0);
      bestAlt = asset;
    }
  }

  const altLead = bestAltScore - btcScore;
  const needsMore = 30 - altLead;

  if (action === "CRASH_EXIT" || action === "STOP_CASH" || action === "HOLD_CASH") {
    return {
      status: "CASH",
      label: "In Cash",
      note: "Strategy is in cash. Re-entry requires BTC 30d momentum to turn positive.",
      blocker: "BTC 30d momentum must turn positive before re-entering.",
    };
  }

  if (holdDays < 3 && position !== "CASH") {
    return {
      status: "HOLD_MIN",
      label: "Min Hold Active",
      note: `Holding ${position} — 3-day minimum hold active (day ${holdDays} of 3).`,
      blocker: `${3 - holdDays} more day${3 - holdDays === 1 ? "" : "s"} until rotation is eligible.`,
    };
  }

  if (bestAlt && altLead >= 30) {
    return {
      status: "ROTATE_READY",
      label: "Rotation Ready",
      note: `${bestAlt} composite score leads BTC by ${altLead.toFixed(1)}pp — rotation threshold of 30pp exceeded.`,
      blocker: null,
    };
  }

  if (bestAlt && altLead > 15) {
    return {
      status: "WATCH",
      label: "Watch",
      note: `${bestAlt} is building momentum — leads BTC by ${altLead.toFixed(1)}pp. Needs ${needsMore.toFixed(1)}pp more to trigger rotation.`,
      blocker: `${bestAlt} needs ${needsMore.toFixed(1)}pp more composite score lead over BTC.`,
    };
  }

  return {
    status: "HOLD",
    label: "Holding",
    note: `Holding ${position} — no alt exceeds BTC composite score by 30pp. BTC is the strongest asset.`,
    blocker: null,
  };
}

// ── Build momentum ranking from market_data ───────────────────────────────────

function buildRanking(state: any): Array<{ asset: string; score: number; mom30: number; price: number; color: string; icon: string }> {
  const mktData = state?.market_data ?? {};
  return Object.entries(mktData)
    .map(([asset, data]: [string, any]) => ({
      asset,
      score:  toNumber(data?.score,   0),
      mom30:  toNumber(data?.mom_30,  0),
      price:  toNumber(data?.price,   0),
      color:  ASSET_COLORS[asset] ?? "oklch(0.60 0.22 255)",
      icon:   ASSET_ICONS[asset]  ?? asset[0],
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Build cash risk monitor data ──────────────────────────────────────────────

function buildCashRisk(state: any): {
  btcPrice:         number;
  btcDd30:          number;
  btcMom30:         number;
  btc30dHigh:       number;
  crashExitLevel:   number;
  stopLossLevel:    number;
  distanceToCrash:  number;
  crashActive:      boolean;
  stopActive:       boolean;
  statusLabel:      string;
  statusTone:       "good" | "warn" | "danger";
} {
  const mktData        = state?.market_data ?? {};
  const btc            = mktData?.BTC ?? {};
  const btcPrice       = toNumber(btc?.price,   0);
  const btcDd30        = toNumber(btc?.dd_30,   0);  // negative fraction e.g. -0.12
  const btcMom30       = toNumber(btc?.mom_30,  0);
  const btc30dHigh     = btcPrice > 0 && btcDd30 < 0
    ? btcPrice / (1 + btcDd30)
    : btcPrice;
  const crashExitLevel = btc30dHigh * 0.75;
  const entryPrice     = toNumber(state?.entry_price, 0);
  const stopLossLevel  = entryPrice > 0 ? entryPrice * 0.85 : 0;
  const distanceToCrash = btcDd30 < 0 ? Math.max(0, 25 + btcDd30 * 100) : 25;
  const crashActive    = btcDd30 <= -0.25;
  const stopActive     = entryPrice > 0 && btcPrice > 0 && ((btcPrice - entryPrice) / entryPrice) <= -0.15;

  let statusLabel: string;
  let statusTone: "good" | "warn" | "danger";

  if (crashActive) {
    statusLabel = "Crash exit active — 100% CASH";
    statusTone  = "danger";
  } else if (btcDd30 <= -0.15) {
    statusLabel = "Warning — approaching crash threshold";
    statusTone  = "warn";
  } else if (stopActive) {
    statusLabel = "Stop loss approaching on current position";
    statusTone  = "warn";
  } else {
    statusLabel = "No cash triggers active";
    statusTone  = "good";
  }

  return {
    btcPrice, btcDd30, btcMom30, btc30dHigh,
    crashExitLevel, stopLossLevel,
    distanceToCrash, crashActive, stopActive,
    statusLabel, statusTone,
  };
}

// ── Main exports ──────────────────────────────────────────────────────────────

export async function getLivePortfolioData() {
  const [state, history] = await Promise.all([
    readJson<any>(STATE_FILE,   {}),
    readJson<any[]>(HISTORY_FILE, []),
  ]);

  const currentPosition   = asString(state?.current_position, "CASH");
  const entryPrice        = toNumber(state?.entry_price,        0);
  const entryDate         = asString(state?.entry_date,         "");
  const holdDays          = toNumber(state?.hold_days,          0);
  const portfolioValue    = toNumber(state?.portfolio_value_usd, 10000);
  const reserveUsd        = toNumber(state?.reserve_usd,        0);
  const totalWealthUsd    = toNumber(state?.total_wealth_usd,   portfolioValue + reserveUsd);
  const lastUpdate        = asString(state?.last_update,        "");
  const action            = asString(state?.action,             "HOLD");
  const reason            = asString(state?.reason,             "");
  const fixedCapital      = 10000;
  const pnlUsd            = portfolioValue - fixedCapital;
  const totalReturnPct    = (pnlUsd / fixedCapital) * 100;
  const totalWealthReturnPct = ((totalWealthUsd - fixedCapital) / fixedCapital) * 100;
  const regimeConf        = toNumber(state?.market_data?.BTC?.regime_conf, 0);
  const regimeLabel       = regimeConf >= 65 ? "Range-Bound" : regimeConf >= 45 ? "Transitioning" : "Trending";
  const regimeTone        = regimeConf >= 65 ? "warn" : regimeConf >= 45 ? "neutral" : "good";

  const readiness         = deriveReadiness(state, history);
  const ranking           = buildRanking(state);
  const cashRisk          = buildCashRisk(state);

  const mktData           = state?.market_data ?? {};
  const btcScore          = toNumber(mktData?.BTC?.score, 0);
  const topCandidates     = ranking.map(r => ({ asset: r.asset, symbol: r.asset, score: r.score }));

  const signalDescription = describeAction(action, currentPosition, reason);

  // Counters from history
  const rotations    = history.filter(r => r.action === "ROTATE").length;
  const crashExits   = history.filter(r => r.action === "CRASH_EXIT").length;
  const stopFires    = history.filter(r => r.action === "STOP_CASH" || r.action === "STOP_TO_BTC").length;
  const cashDays     = history.filter(r => r.position === "CASH").length;
  const cashoutFires = history.filter(r => (r.cashout_amount ?? 0) > 0).length;
  const totalCashedOut = history.reduce((sum, r) => sum + toNumber(r.cashout_amount, 0), 0);
  const regimeBlocks = history.filter(r => r.action === "HOLD" && (r.reason ?? "").includes("choppy regime")).length;

  return {
    source: {
      root:       DASHBOARD_ROOT,
      stateFile:  STATE_FILE,
      historyFile: HISTORY_FILE,
      strategy:   "BULL_ROTATE v2.0",
    },
    summary: {
      fixedCapitalUsd:            fixedCapital,
      displayedPortfolioValueUsd: portfolioValue,
      liveStrategyValueUsd:       portfolioValue,
      reserveUsd,
      totalWealthUsd,
      totalWealthReturnPct,
      pnlUsd,
      totalReturnPct,
      currentAsset:               currentPosition,
      signalAction:               action,
      ruleReason:                 signalDescription,
      lastUpdate,
      holdDays,
      entryPrice,
      entryDate,
      marketRegime:               cashRisk.crashActive ? "CRASH" : cashRisk.btcDd30 <= -0.15 ? "CAUTION" : "BULL",
      regimeConf,
      regimeLabel,
      regimeTone,
      regimeConfidence:           readiness.label,
      confidenceLabel:            readiness.label,
    },
    performance: {
      btcHoldValueUsd:     0,  // populated by script if tracking BTC benchmark
      outperformanceUsd:   0,
      outperformancePct:   0,
      unrealisedPnlUsd:    pnlUsd,
      unrealisedPnlPct:    totalReturnPct,
      counters: {
        rotations,
        crashExits,
        stopFires,
        cashDays,
        cashoutFires,
        totalCashedOut,
        regimeBlocks,
        totalTrades: rotations + crashExits + stopFires,
      },
    },
    preparation: {
      readiness:     readiness.status,
      label:         readiness.label,
      note:          readiness.note,
      targetAsset:   ranking.filter(r => r.asset !== "BTC")[0]?.asset ?? "",
      topCandidates,
    },
    planning: {
      currentBlocker:            readiness.blocker ?? "Monitoring live conditions",
      candidateAsset:            ranking.filter(r => r.asset !== "BTC")[0]?.asset ?? "",
      currentAsset:              currentPosition,
      holdDays,
      nextActionSummary:         readiness.note,
      rule2Active:               holdDays < 3 && currentPosition !== "CASH",
      rule3Active:               false,
      rule4Ready:                null,
      latestThirtyDayHighDateUtc: "",
      blockExpiresAfterCloseUtc:  "",
      earliestEligibleRunUtc:     "",
      earliestEligibleRunLabel:   holdDays < 3 ? `${3 - holdDays} day${3 - holdDays === 1 ? "" : "s"} remaining` : "Eligible now",
    },
    cashRisk,
    ranking,
    tradeHistory: Array.isArray(history) ? [...history].reverse().slice(0, 50) : [],
    raw: { state, marketData: mktData },
  };
}

export async function getLiveDashboardData() {
  const snapshot = await getLivePortfolioData();
  const { summary, preparation, planning, cashRisk, ranking, tradeHistory } = snapshot;

  return {
    liveStrategy: {
      status: {
        currentPosition:            summary.currentAsset,
        signalAction:               summary.signalAction,
        holdDays:                   summary.holdDays,
        entryPrice:                 summary.entryPrice,
        entryDate:                  summary.entryDate,
        lastUpdate:                 summary.lastUpdate,
        ruleReason:                 summary.ruleReason,
        displayedPortfolioValueUsd: summary.displayedPortfolioValueUsd,
        fixedCapitalUsd:            summary.fixedCapitalUsd,
      },
      performance: snapshot.performance,
      preparation,
      planning,
      cashRisk,
      ranking,
      tradeHistory,
    },
    forecast: {
      generatedAtUtc:   summary.lastUpdate,
      sourceMode:       "bull_rotate_v2",
      currentPosition: {
        asset:            summary.currentAsset,
        allocation:       summary.currentAsset === "CASH" ? 0 : 1,
        holdDays:         summary.holdDays,
        entryPrice:       summary.entryPrice,
        entryDate:        summary.entryDate,
        portfolioValueUsd: summary.displayedPortfolioValueUsd,
      },
      momentumRanking:  ranking.map(r => ({ asset: r.asset, symbol: r.asset, score: r.score })),
      nextTrade: {
        actionIfRunNow:   summary.signalAction,
        targetAsset:      preparation.targetAsset,
        reason:           summary.ruleReason,
        conditionsNeeded: planning.currentBlocker && planning.currentBlocker !== "Monitoring live conditions"
          ? [planning.currentBlocker]
          : [],
      },
      rules: {
        rule2Active:    planning.rule2Active,
        rule3Active:    planning.rule3Active,
        rule4Ready:     planning.rule4Ready,
        currentBlocker: planning.currentBlocker,
      },
      confidence: {
        score:            0,
        label:            preparation.label,
        fearGreedValue:   0,
        fearGreedAverage: 0,
      },
      forwardOutlook: [],
    },
    source:  snapshot.source,
    refresh: {
      pollingMs:                5 * 60 * 1000,
      dailyCloseUtc:            "00:05",
      lastSuccessfulUpdateUtc:  summary.lastUpdate,
    },
    legacy: {
      status: {
        currentPosition:            summary.currentAsset,
        signalAction:               summary.signalAction,
        holdDays:                   summary.holdDays,
        entryPrice:                 summary.entryPrice,
        entryDate:                  summary.entryDate,
        lastUpdate:                 summary.lastUpdate,
        ruleReason:                 summary.ruleReason,
        displayedPortfolioValueUsd: summary.displayedPortfolioValueUsd,
        fixedCapitalUsd:            summary.fixedCapitalUsd,
      },
      ranking:      ranking.map(r => ({ asset: r.asset, symbol: r.asset, score: r.score })),
      preparation,
      planning,
      tradeHistory,
    },
  };
}
