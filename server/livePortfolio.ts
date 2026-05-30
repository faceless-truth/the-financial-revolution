/**
 * BULL_ROTATE v4.1 — Server Data Adapter (schema v3.0)
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
const MSB_FILE            = process.env.BULL_ROTATE_MSB_FILE     ?? path.join(DASHBOARD_ROOT, "msb_signals.json");
const OPTIMIZED_DATA_FILE = path.join(DASHBOARD_ROOT, "optimized_strategy_data.json");
const LUNARCRUSH_API_KEY = process.env.LUNARCRUSH_API_KEY ?? "";
const LUNARCRUSH_TOPIC_MAP: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin", SUI: "sui",
};

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
    case "HOLD_MIN":     return `Holding — minimum hold active`;
    case "HOLD_CASH":    return reason || `Holding CASH — waiting for re-entry conditions`;
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

  const msbWaitLocal   = toNumber(state?.msb_wait_days, 0);
  const msbWaitingLocal = Boolean(state?.msb_waiting ?? false);
  const btcMom30Local  = toNumber(state?.market_data?.BTC?.mom_30, 0);
  if (action === "CRASH_EXIT" || action === "STOP_CASH" || action === "HOLD_CASH") {
    if (btcMom30Local > 0 && msbWaitingLocal) {
      const btcBreakout = toNumber(state?.market_data?.BTC?.breakout_level, 0);
      const daysLeft = Math.max(0, 5 - msbWaitLocal);
      return {
        status: "CASH_WAITING_MSB",
        label: `Waiting for BTC MSB (day ${msbWaitLocal} of 5)`,
        note: `Regime is bullish (+${btcMom30Local.toFixed(1)}% 30d). Waiting for BTC to close above $${btcBreakout > 0 ? btcBreakout.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "breakout level"}. Fallback entry in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        blocker: btcBreakout > 0 ? `BTC must close above $${btcBreakout.toLocaleString("en-US", { maximumFractionDigits: 0 })} for MSB entry` : "Waiting for BTC MSB breakout",
      };
    }
    return {
      status: "CASH",
      label: "In Cash",
      note: btcMom30Local <= 0 ? `Holding CASH — BTC 30d momentum is ${btcMom30Local.toFixed(1)}% (must turn positive to re-enter).` : "Strategy is in cash. Re-entry requires BTC MSB breakout or 5-day fallback.",
      blocker: btcMom30Local <= 0 ? "BTC 30d momentum must turn positive before re-entering." : "Waiting for BTC MSB breakout signal.",
    };
  }

  const minHoldDaysLocal = toNumber(state?.min_hold_days, 7);
  if (holdDays < minHoldDaysLocal && position !== "CASH") {
    return {
      status: "HOLD_MIN",
      label: `Min Hold — Day ${holdDays} of ${minHoldDaysLocal}`,
      note: `Holding ${position} — minimum hold active (day ${holdDays} of ${minHoldDaysLocal}). Rotation rules are gated until day ${minHoldDaysLocal}.`,
      blocker: `${minHoldDaysLocal - holdDays} more day${minHoldDaysLocal - holdDays === 1 ? "" : "s"} until rotation is eligible.`,
    };
  }

  // v4.0: use TFR scores for rotation readiness (threshold = 1.5 points)
  const mktDataForTfr = state?.market_data ?? {};
  const btcTfrLocal = toNumber((mktDataForTfr?.BTC as any)?.tfr_score, 0);
  let bestAltTfr = "";
  let bestAltTfrScore = -Infinity;
  for (const [asset, data] of Object.entries(mktDataForTfr) as [string, any][]) {
    if (asset !== "BTC") {
      const tfrScore = toNumber((data as any)?.tfr_score, 0);
      if (tfrScore > bestAltTfrScore) { bestAltTfrScore = tfrScore; bestAltTfr = asset; }
    }
  }
  const tfrLead = bestAltTfrScore - btcTfrLocal;
  const TFR_THRESHOLD = 1.5;
  if (bestAltTfr && tfrLead >= TFR_THRESHOLD) {
    return {
      status: "ROTATE_READY",
      label: "Rotation Signal Active",
      note: `${bestAltTfr} TFR score (${bestAltTfrScore.toFixed(3)}) leads BTC (${btcTfrLocal.toFixed(3)}) by +${tfrLead.toFixed(3)} — rotation threshold of ${TFR_THRESHOLD} exceeded.`,
      blocker: null,
    };
  }
  if (bestAltTfr && tfrLead > 0.8) {
    return {
      status: "WATCH",
      label: "Building",
      note: `${bestAltTfr} TFR score (${bestAltTfrScore.toFixed(3)}) is building — leads BTC by +${tfrLead.toFixed(3)}. Needs +${(TFR_THRESHOLD - tfrLead).toFixed(3)} more to trigger rotation.`,
      blocker: `${bestAltTfr} needs +${(TFR_THRESHOLD - tfrLead).toFixed(3)} more TFR lead over BTC.`,
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
    note: btcMom30Local > 0 ? `Holding ${position} — BTC is strongest asset. ${bestAltTfr ? `${bestAltTfr} leads BTC TFR by +${tfrLead.toFixed(2)} pts (need 1.5 to rotate).` : "No rotation signal."}` : `Holding ${position} — BTC 30d momentum ${btcMom30Local.toFixed(1)}%.`,
    blocker: null,
  };
}

// ── Build momentum ranking from market_data ───────────────────────────────────

function buildRanking(state: any, lc?: Record<string, any>): Array<{ asset: string; score: number; mom30: number; price: number; color: string; icon: string; galaxyScore: number; altRank: number; sentiment: number; prevGalaxyScore: number; prevAltRank: number; prevSentiment: number; trend: string }> {
  const mktData = state?.market_data ?? {};
  return Object.entries(mktData)
    .map(([asset, data]: [string, any]) => {
      const lcData = lc?.[asset] ?? {};
      return {
        asset,
        score:           toNumber(data?.score,     0),
        tfrScore:        toNumber((data as any)?.tfr_score, 0),
        mom30:           toNumber(data?.mom_30,    0),
        price:           toNumber(data?.price,     0),
        color:           ASSET_COLORS[asset] ?? "oklch(0.60 0.22 255)",
        icon:            ASSET_ICONS[asset]  ?? asset[0],
        galaxyScore:     toNumber(lcData.galaxyScore,     0),
        altRank:         toNumber(lcData.altRank,         0),
        sentiment:       toNumber(lcData.sentiment,       0),
        prevGalaxyScore: toNumber(lcData.prevGalaxyScore, 0),
        prevAltRank:     toNumber(lcData.prevAltRank,     0),
        prevSentiment:   toNumber(lcData.prevSentiment,   0),
        trend:           lcData.trend ?? "",
      };
    })
    .sort((a, b) => (b.tfrScore || b.score) - (a.tfrScore || a.score));
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
  regimeExitPrice:      number;
  distanceToRegimeExit: number;
} {
  const mktData        = state?.market_data ?? {};
  const btc            = mktData?.BTC ?? {};
  const btcPrice       = toNumber(btc?.price,   0);
  const btcDd30        = toNumber(btc?.dd_30,   0);
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
  const price30dAgo    = btcMom30 !== -100 && btcPrice > 0 ? btcPrice / (1 + btcMom30 / 100) : 0;
  const regimeExitPrice = price30dAgo > 0 ? price30dAgo * 0.95 : 0;
  const distanceToRegimeExit = regimeExitPrice > 0 && btcPrice > 0 ? ((btcPrice - regimeExitPrice) / btcPrice) * 100 : 0;

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
    regimeExitPrice, distanceToRegimeExit,
  };
}


// ── LunarCrush social metrics ─────────────────────────────────────────────────
interface LunarCrushMetrics {
  galaxyScore:    number;
  altRank:        number;
  sentiment:      number;
  interactions24h: number;
  numPosts:       number;
  trend:          string;
  prevGalaxyScore: number;
  prevAltRank:    number;
  prevSentiment:  number;
}

const LUNARCRUSH_CACHE_FILE = path.join(DASHBOARD_ROOT, "lunarcrush_cache.json");
const LUNARCRUSH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getLunarCrushData(): Promise<Record<string, LunarCrushMetrics>> {
  const assets = ["BTC", "ETH", "SOL", "DOGE", "SUI"];
  const results: Record<string, LunarCrushMetrics> = {};

  // Try to read from cache first
  try {
    const cacheRaw = await fs.readFile(LUNARCRUSH_CACHE_FILE, "utf8");
    const cacheData = JSON.parse(cacheRaw);
    if (cacheData && cacheData.timestamp && (Date.now() - cacheData.timestamp < LUNARCRUSH_CACHE_TTL_MS)) {
      return cacheData.data;
    }
  } catch (e) {
    // Cache miss or invalid, proceed to fetch
  }

  let fetchedAny = false;

  await Promise.all(assets.map(async (asset) => {
    const empty: LunarCrushMetrics = {
      galaxyScore: 0, altRank: 0, sentiment: 0,
      interactions24h: 0, numPosts: 0, trend: "",
      prevGalaxyScore: 0, prevAltRank: 0, prevSentiment: 0,
    };
    if (!LUNARCRUSH_API_KEY) { results[asset] = empty; return; }
    try {
      // Current snapshot — coin endpoint
      const coinRes = await fetch(
        `https://lunarcrush.com/api4/public/coins/${asset}/v1`,
        { headers: { Authorization: `Bearer ${LUNARCRUSH_API_KEY}` } }
      );
      const coinJson = await coinRes.json() as any;
      const coin = coinJson?.data ?? {};

      // Social topic snapshot
      const topic = LUNARCRUSH_TOPIC_MAP[asset] ?? asset.toLowerCase();
      const topicRes = await fetch(
        `https://lunarcrush.com/api4/public/topic/${topic}/v1`,
        { headers: { Authorization: `Bearer ${LUNARCRUSH_API_KEY}` } }
      );
      const topicJson = await topicRes.json() as any;
      const topicData = topicJson?.data ?? {};

      // Previous day — time series (last 2 days)
      const tsRes = await fetch(
        `https://lunarcrush.com/api4/public/coins/${asset}/time-series/v2?interval=1d&start=${Math.floor(Date.now() / 1000) - 86400 * 2}`,
        { headers: { Authorization: `Bearer ${LUNARCRUSH_API_KEY}` } }
      );
      const tsJson = await tsRes.json() as any;
      const tsRows: any[] = tsJson?.data ?? [];
      const prevRow = tsRows.length >= 2 ? tsRows[tsRows.length - 2] : null;

      // Sentiment: average across available platforms
      const sentMap: Record<string, number> = topicData?.types_sentiment ?? {};
      const sentVals = Object.values(sentMap).filter((v): v is number => typeof v === "number" && v > 0);
      const sentiment = sentVals.length > 0 ? Math.round(sentVals.reduce((a, b) => a + b, 0) / sentVals.length) : 0;

      results[asset] = {
        galaxyScore:     typeof coin.galaxy_score === "number" ? coin.galaxy_score : 0,
        altRank:         typeof coin.alt_rank     === "number" ? coin.alt_rank     : 0,
        sentiment,
        interactions24h: typeof topicData.interactions_24h === "number" ? topicData.interactions_24h : 0,
        numPosts:        typeof topicData.num_posts         === "number" ? topicData.num_posts         : 0,
        trend:           typeof topicData.trend             === "string" ? topicData.trend             : "",
        prevGalaxyScore: prevRow?.galaxy_score ?? 0,
        prevAltRank:     prevRow?.alt_rank     ?? 0,
        prevSentiment:   prevRow?.sentiment    ?? 0,
      };
      fetchedAny = true;
    } catch {
      results[asset] = empty;
    }
  }));

  // Save to cache if we successfully fetched data
  if (fetchedAny) {
    try {
      await fs.writeFile(LUNARCRUSH_CACHE_FILE, JSON.stringify({
        timestamp: Date.now(),
        data: results
      }, null, 2));
    } catch (e) {
      console.error("Failed to write LunarCrush cache:", e);
    }
  }

  return results;
}

// ── Main exports ──────────────────────────────────────────────────────────────

export async function getLivePortfolioData() {
  const [state, history, lunarCrush, optData] = await Promise.all([
    readJson<any>(STATE_FILE,   {}),
    readJson<any[]>(HISTORY_FILE, []),
    getLunarCrushData(),
    readJson<any>(OPTIMIZED_DATA_FILE, {}),
  ]);

  const currentPosition   = asString(state?.current_position, "CASH");
  const entryPrice        = toNumber(state?.entry_price,        0);
  const entryDate         = asString(state?.entry_date,         "");
  const holdDays          = toNumber(state?.hold_days,          0);
  const portfolioValue    = toNumber(state?.portfolio_value_usd, 67428);
  const reserveUsd        = toNumber(state?.reserve_usd,        0);
  const totalWealthUsd    = toNumber(state?.total_wealth_usd,   portfolioValue + reserveUsd);
  const lastUpdate        = asString(state?.last_update,        "");
  const action            = asString(state?.action,             "HOLD");
  const reason            = asString(state?.reason,             "");
  const fixedCapital      = 67428;
  // NOTE: pnlUsd and totalReturnPct are computed AFTER currentPositionValueUsd below
  // so we defer them — placeholder values here, overridden after BTC qty calc
  const totalWealthReturnPct = ((totalWealthUsd - fixedCapital) / fixedCapital) * 100;
  const regimeConf        = toNumber(state?.market_data?.BTC?.regime_conf, 0);
  const mktData           = state?.market_data ?? {};
  // ── Position-unit-based unrealised P&L ─────────────────────────────────────
  // positionUnits = how many units of the current asset were bought with portfolioValue
  // e.g. if portfolioValue=$67,428 and DOGE entry=$0.1078 → positionUnits=625,490 DOGE
  // This works for BTC, DOGE, SOL, ETH or any other asset.
  const currentAssetPrice = currentPosition !== "CASH"
    ? toNumber(mktData?.[currentPosition]?.price, 0)
    : 0;
  // positionUnits: derived from the portfolio value at entry divided by the entry price.
  // portfolioValue here is the value AT THE TIME OF ENTRY (stored by bull_rotate.py).
  // We use it as the cost basis to compute how many units were purchased.
  const positionUnits     = currentPosition !== "CASH" && entryPrice > 0
    ? portfolioValue / entryPrice
    : 0;
  const unrealisedPnlUsd  = currentPosition !== "CASH" && entryPrice > 0 && currentAssetPrice > 0
    ? positionUnits * (currentAssetPrice - entryPrice)
    : 0;
  const unrealisedPnlPct  = entryPrice > 0
    ? ((currentAssetPrice - entryPrice) / entryPrice) * 100
    : 0;
  // ── currentPositionValueUsd ────────────────────────────────────────────────
  // When IN a position: positionUnits × current asset price (mark-to-market)
  // When IN CASH: use the portfolio_value_usd from the state file (cash value at exit)
  const currentPositionValueUsd = currentPosition !== "CASH" && currentAssetPrice > 0 && positionUnits > 0
    ? positionUnits * currentAssetPrice
    : portfolioValue;   // portfolioValue = cash held after exit

  // Total Wealth = currentPositionValueUsd + reserveUsd
  // Starting capital = $67,428 (the fixed capital when BULL_ROTATE started)
  const correctedTotalWealthUsd       = currentPositionValueUsd + reserveUsd;
  const correctedTotalWealthReturnPct = ((correctedTotalWealthUsd - fixedCapital) / fixedCapital) * 100;

  // Active portfolio P&L: based on currentPositionValueUsd vs fixed capital
  const pnlUsd         = currentPositionValueUsd - fixedCapital;
  const totalReturnPct = (pnlUsd / fixedCapital) * 100;

  // ── Last completed trade result from history ──────────────────────────────
  // Find the most recent trade that was an entry (not a hold), then look for
  // the subsequent exit to compute the realised P&L of the previous trade.
  const sortedHistory = Array.isArray(history) ? [...history] : [];
  // History is stored oldest-first; find the last ENTRY before the current one
  const exitActions = ["CRASH_EXIT", "STOP_CASH", "STOP_TO_BTC", "ROTATE", "WYCKOFF_DIST_EXIT_TO_CASH", "WYCKOFF_DIST_EXIT_TO_BTC", "REGIME_EXIT", "MSB_EXIT", "MSB_ENTRY_BTC", "REENTER_BTC", "MSB_ENTRY"];
  const lastExitRecord = sortedHistory.filter(r => exitActions.includes(asString(r.action, ""))).slice(-1)[0] ?? null;
  const prevTradeAction   = lastExitRecord ? asString(lastExitRecord.action, "") : "";
  const prevTradeDate     = lastExitRecord ? asString(lastExitRecord.date, "") : "";
  const prevTradePosition = lastExitRecord ? asString(lastExitRecord.position, "") : "";
  // Estimate previous trade P&L from portfolio value delta around the exit
  const prevTradePortfolioValue = lastExitRecord ? toNumber(lastExitRecord.portfolio_value, 0) : 0;
  // v4.0: regime label based on BTC 30d momentum (bull/bear), not just choppiness
  const btcMom30          = toNumber(state?.market_data?.BTC?.mom_30, 0);
  const msbWaiting        = Boolean(state?.msb_waiting ?? false);
  const msbWaitDays       = toNumber(state?.msb_wait_days, 0);
  const strategyVersion   = asString(state?.strategy_version, "v3.0");
  // Build TFR scores from market_data
  const tfrScores: Record<string, number> = {};
  for (const [asset, data] of Object.entries(mktData) as [string, any][]) {
    tfrScores[asset] = toNumber((data as any)?.tfr_score, 0);
  }
  const btcTfr            = tfrScores["BTC"] ?? 0;
  const regimeLabel       = btcMom30 > 0 ? "BULLISH" : btcMom30 < -0.2 ? "BEARISH" : "NEUTRAL";
  const regimeTone        = btcMom30 > 0 ? "good" : btcMom30 < -0.2 ? "danger" : "warn";

  const readiness         = deriveReadiness(state, history);
  const ranking           = buildRanking(state, lunarCrush);
  const cashRisk          = buildCashRisk(state);

  const btcScore          = toNumber(mktData?.BTC?.score, 0);
  const topCandidates     = ranking.map(r => ({ asset: r.asset, symbol: r.asset, score: r.score }));

  const signalDescription = describeAction(action, currentPosition, reason);

  // Counters from history
  // totalTrades = all meaningful position changes (entries, exits, rotations)
  const entryActions = ["REENTER_BTC", "ROTATE", "MSB_ENTRY"];
  const exitActionsFull = ["CRASH_EXIT", "STOP_CASH", "STOP_TO_BTC", "REGIME_EXIT",
    "WYCKOFF_DIST_EXIT_TO_CASH", "WYCKOFF_DIST_EXIT_TO_BTC", "MSB_EXIT"];
  const rotations    = history.filter(r => r.action === "ROTATE").length;
  const crashExits   = history.filter(r => r.action === "CRASH_EXIT").length;
  const stopFires    = history.filter(r => r.action === "STOP_CASH" || r.action === "STOP_TO_BTC").length;
  const regimeExits  = history.filter(r => r.action === "REGIME_EXIT" || r.action === "MSB_EXIT").length;
  const entries      = history.filter(r => entryActions.includes(asString(r.action, ""))).length;
  const cashDays     = history.filter(r => r.position === "CASH").length;
  const cashoutFires = history.filter(r => (r.cashout_amount ?? 0) > 0).length;
  const totalCashedOut = history.reduce((sum, r) => sum + toNumber(r.cashout_amount, 0), 0);
  const regimeBlocks = history.filter(r => r.action === "HOLD" && (r.reason ?? "").includes("choppy regime")).length;
  // totalTrades = entries + exits (each round-trip counts as 2 events, but we show entries as the trade count)
  const totalTrades  = entries + rotations + crashExits + stopFires + regimeExits;

  return {
    source: {
      root:       DASHBOARD_ROOT,
      stateFile:  STATE_FILE,
      historyFile: HISTORY_FILE,
      strategy:   "BULL_ROTATE v4.1",
    },
    summary: {
      fixedCapitalUsd:            fixedCapital,
      displayedPortfolioValueUsd: portfolioValue,
      liveStrategyValueUsd:       portfolioValue,
      reserveUsd,
      totalWealthUsd:             correctedTotalWealthUsd,
      totalWealthReturnPct:       correctedTotalWealthReturnPct,
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
      btcMom30,
      msbWaiting,
      msbWaitDays,
      msbWaitLimit:               toNumber(optData?.current_state?.msb_wait_limit, 5),
      strategyVersion,
      tfrScores,
      btcTfr,
      // v4.1 optimized_strategy_data fields (optional — populated after first cron run)
      btcBreakoutLevel:           toNumber(optData?.rules_status?.rule_6_entry?.btc_breakout_level, 0),
      ethBreakoutLevel:           toNumber(optData?.rules_status?.rule_6_entry?.eth_breakout_level, 0),
      btcDistancePct:             toNumber(optData?.rules_status?.rule_6_entry?.btc_distance_pct, 0),
      fallbackInDays:             toNumber(optData?.rules_status?.rule_6_entry?.fallback_in_days, 0),
      predictedAction:            asString(optData?.next_action_forecast?.predicted_action, ""),
      predictedReason:            asString(optData?.next_action_forecast?.predicted_reason, ""),
      triggerConditions:          Array.isArray(optData?.next_action_forecast?.trigger_conditions) ? optData.next_action_forecast.trigger_conditions : [] as Array<{label: string; probability: string}>,
      leaderAsset:                asString(optData?.scores?.leader, ""),
      leadOverBtc:                toNumber(optData?.scores?.lead_over_btc, 0),
      rotThreshold:               toNumber(optData?.parameters?.tfr_rotation_threshold, 1.5),
      minHoldDays:                toNumber(optData?.parameters?.min_hold_days, 7),
    },
    performance: {
      btcHoldValueUsd:     0,  // populated by script if tracking BTC benchmark
      outperformanceUsd:   0,
      outperformancePct:   0,
      // Unrealised P&L: positionUnits × (currentPrice − entryPrice)
      unrealisedPnlUsd,
      unrealisedPnlPct,
      currentPositionValueUsd,
      positionUnits,
      currentAssetPrice,
      // Previous completed trade
      lastTrade: {
        action:         prevTradeAction,
        date:           prevTradeDate,
        position:       prevTradePosition,
        portfolioValue: prevTradePortfolioValue,
      },
      counters: {
        rotations,
        crashExits,
        stopFires,
        cashDays,
        cashoutFires,
        totalCashedOut,
        regimeBlocks,
        totalTrades,
        regimeExits,
        entries,
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

// ── MSB Signals export ───────────────────────────────────────────────────────

export async function getMsbSignals() {
  const raw = await readJson<any>(MSB_FILE, {});
  const lastUpdate = asString(raw?.last_update, "");
  const assets = raw?.assets ?? {};

  // Normalise each asset's MSB data into a clean typed shape
  const signals = Object.entries(assets).map(([asset, data]: [string, any]) => ({
    asset,
    currentPrice:    toNumber(data?.current_price, 0),
    atr:             toNumber(data?.atr, 0),
    signal:          asString(data?.signal, "UNKNOWN"),
    signalLabel:     asString(data?.signal_label, ""),
    signalTone:      asString(data?.signal_tone, "neutral"),
    structure:       asString(data?.structure, "NEUTRAL"),
    structureLabel:  asString(data?.structure_label, ""),
    bullishMsb:      Boolean(data?.bullish_msb),
    bearishMsb:      Boolean(data?.bearish_msb),
    lastPivotHigh:   data?.last_pivot_high ?? null,
    lastPivotLow:    data?.last_pivot_low  ?? null,
    breakoutLevel:   data?.breakout_level  != null ? toNumber(data.breakout_level, 0) : null,
    breakdownLevel:  data?.breakdown_level != null ? toNumber(data.breakdown_level, 0) : null,
    distToPhPct:     data?.dist_to_ph_pct  != null ? toNumber(data.dist_to_ph_pct, 0)  : null,
    distToPlPct:     data?.dist_to_pl_pct  != null ? toNumber(data.dist_to_pl_pct, 0)  : null,
    phTrend:         asString(data?.ph_trend, "unknown"),
    plTrend:         asString(data?.pl_trend, "unknown"),
    recentPivotHighs: Array.isArray(data?.recent_pivot_highs) ? data.recent_pivot_highs : [],
    recentPivotLows:  Array.isArray(data?.recent_pivot_lows)  ? data.recent_pivot_lows  : [],
    color:           ASSET_COLORS[asset] ?? "oklch(0.60 0.22 255)",
    icon:            ASSET_ICONS[asset]  ?? asset[0],
  }));

  // Also expose trade_alerts for the Trade Alert panel
  const rawAlerts = raw?.trade_alerts ?? {};
  const tradeAlerts = Object.entries(rawAlerts).map(([asset, d]: [string, any]) => ({
    asset,
    signal:           asString(d?.signal, "RANGING"),
    // Fallback: if price is 0 in trade_alerts, use current_price from assets section
    price:            toNumber(d?.price, 0) || toNumber(assets[asset]?.current_price, 0),
    atr:              d?.atr != null ? toNumber(d.atr, 0) : null,
    // BUY trigger
    buyTrigger:       d?.buy_trigger       != null ? toNumber(d.buy_trigger, 0)       : null,
    buyTriggerPct:    d?.buy_trigger_pct   != null ? toNumber(d.buy_trigger_pct, 0)   : null,
    // SELL trigger
    sellTrigger:      d?.sell_trigger      != null ? toNumber(d.sell_trigger, 0)      : null,
    sellTriggerPct:   d?.sell_trigger_pct  != null ? toNumber(d.sell_trigger_pct, 0)  : null,
    // Stop loss estimate (for new entries)
    stopLossEst:      d?.stop_loss_est     != null ? toNumber(d.stop_loss_est, 0)     : null,
    stopPctEst:       d?.stop_pct_est      != null ? toNumber(d.stop_pct_est, 0)      : null,
    // Actual entry/stop if currently in position
    actualEntry:      d?.actual_entry      != null ? toNumber(d.actual_entry, 0)      : null,
    actualStop:       d?.actual_stop       != null ? toNumber(d.actual_stop, 0)       : null,
    actualStopPct:    d?.actual_stop_pct   != null ? toNumber(d.actual_stop_pct, 0)   : null,
    alertActive:      Boolean(d?.alert_active),
    color:            ASSET_COLORS[asset] ?? "oklch(0.60 0.22 255)",
    icon:             ASSET_ICONS[asset]  ?? asset[0],
  }));

  return {
    lastUpdate,
    signals,
    tradeAlerts,
    available: signals.length > 0,
  };
}


// ── Squeeze Scanner export ────────────────────────────────────────────────────
const SQUEEZE_FILE = path.join(DASHBOARD_ROOT, "squeeze_candidates.json");

export async function getSqueezeData() {
  const raw = await readJson<any>(SQUEEZE_FILE, null);
  if (!raw) {
    return {
      available: false,
      lastUpdated: null,
      symbolsScanned: 0,
      candidatesFound: 0,
      minConfidence: 45,
      nextScanHours: 8,
      candidates: [],
    };
  }
  const candidates = (raw.candidates ?? []).slice(0, 3).map((c: any) => ({
    symbol:   String(c.symbol ?? ""),
    base:     String(c.base ?? c.symbol?.replace("USDT","") ?? ""),
    price:    Number(c.price ?? 0),
    score:    Number(c.score ?? 0),
    confidence: Number(c.confidence ?? c.score ?? 0),
    components: {
      fundingNegativity: Number(c.components?.funding_negativity ?? 0),
      oiBuild:           Number(c.components?.oi_build ?? 0),
      smartMoneyLong:    Number(c.components?.smart_money_long ?? 0),
      priceStructure:    Number(c.components?.price_structure ?? 0),
    },
    raw: {
      fundingLast:       Number(c.raw?.funding_last ?? 0),
      fundingCum3p:      Number(c.raw?.funding_cumulative_3p ?? 0),
      fundingNegStreak:  Number(c.raw?.funding_neg_streak ?? 0),
      oiUsd:             Number(c.raw?.oi_usd ?? 0),
      oiChange5dPct:     Number(c.raw?.oi_change_5d_pct ?? 0),
      lsRatio:           c.raw?.ls_ratio != null ? Number(c.raw.ls_ratio) : null,
      lsLongsPct:        c.raw?.ls_longs_pct != null ? Number(c.raw.ls_longs_pct) : null,
      priceVsEma20:      c.raw?.price_vs_ema20 != null ? Number(c.raw.price_vs_ema20) : null,
      atrPct:            c.raw?.atr_pct != null ? Number(c.raw.atr_pct) : null,
    },
  }));
  return {
    available: true,
    lastUpdated:      String(raw.last_updated ?? ""),
    symbolsScanned:   Number(raw.symbols_scanned ?? 0),
    candidatesFound:  Number(raw.candidates_found ?? 0),
    minConfidence:    Number(raw.min_confidence_threshold ?? 45),
    nextScanHours:    Number(raw.next_scan_hours ?? 8),
    candidates,
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
        // Regime fields — required for BTC Regime and Regime Gate cards
        regimeConf:                 summary.regimeConf,
        regimeLabel:                summary.regimeLabel,
        regimeTone:                 summary.regimeTone,
        // Wealth fields
        reserveUsd:                 summary.reserveUsd,
        totalWealthUsd:             summary.totalWealthUsd,
        totalWealthReturnPct:       summary.totalWealthReturnPct,
        // v4.1 fields
        btcMom30:                   summary.btcMom30,
        msbWaiting:                 summary.msbWaiting,
        msbWaitDays:                summary.msbWaitDays,
        msbWaitLimit:               summary.msbWaitLimit,
        btcBreakoutLevel:           summary.btcBreakoutLevel,
        ethBreakoutLevel:           summary.ethBreakoutLevel,
        btcDistancePct:             summary.btcDistancePct,
        fallbackInDays:             summary.fallbackInDays,
        predictedAction:            summary.predictedAction,
        predictedReason:            summary.predictedReason,
        triggerConditions:          summary.triggerConditions,
        leaderAsset:                summary.leaderAsset,
        leadOverBtc:                summary.leadOverBtc,
        rotThreshold:               summary.rotThreshold,
        minHoldDays:                summary.minHoldDays,
        tfrScores:                  summary.tfrScores,
        btcTfr:                     summary.btcTfr,
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
      sourceMode:       "bull_rotate_v4.1",
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
