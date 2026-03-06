/**
 * useBinanceData — TREND_CONFIRM v7.0 live data hook
 * Fetches daily OHLCV from Binance public API, computes all strategy indicators,
 * and returns a fully-evaluated signal object.
 *
 * Strategy parameters (mirrors Python implementation):
 *   MOMENTUM_PERIOD = 30
 *   HIGH_LOOKBACK   = 30
 *   CASH_PARTIAL    = 0.12
 *   CASH_FULL       = 0.25
 *   MIN_HOLD_DAYS   = 14
 *   BTC_NEW_HIGH_DAYS = 5
 *   BREAKOUT_THRESHOLD = 0.05
 */

import { useCallback, useEffect, useRef, useState } from "react";

const BINANCE_API = "https://api.binance.com/api/v3/klines";
const MAJORS = ["BTC", "ETH", "SOL", "SUI", "DOGE"] as const;
type Asset = (typeof MAJORS)[number];

const PER_ASSET_MAX_CAPS: Record<Asset, number> = {
  BTC: 1.0,
  ETH: 1.0,
  SOL: 1.0,
  SUI: 0.6,
  DOGE: 0.6,
};

const MOMENTUM_PERIOD = 30;
const HIGH_LOOKBACK = 30;
const CASH_PARTIAL_THRESHOLD = 0.12;
const CASH_FULL_THRESHOLD = 0.25;
const MIN_HOLD_DAYS = 14;
const BTC_NEW_HIGH_DAYS = 5;
const BREAKOUT_THRESHOLD = 0.05;

export interface OHLCVRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetMetrics {
  asset: Asset;
  currentPrice: number;
  momentum30: number;       // % 30-day momentum
  high30: number;           // 30-day rolling high
  drawdown30: number;       // fraction from 30-day high
  nearHigh: boolean;        // within BREAKOUT_THRESHOLD of 30-day high
  btcRallying: boolean;     // BTC made new high in last 5 days (BTC only)
  priceChange24h: number;   // % 24h change
}

export interface ReentryRolling {
  daysFromNow: number;
  triggerPrice: number;
  deltaVsTodayPct: number;
  deltaVsTodayUsd: number;
}

export interface ReentryTrigger {
  triggerPrice: number;
  currentBtcPrice: number;
  gapUsd: number;
  gapPct: number;
  alreadyMet: boolean;
  rollingTriggers: ReentryRolling[];
}

export type SignalAction = "BUY" | "SELL_ALL" | "ROTATE" | "REBALANCE" | "HOLD";
export type RuleTriggered =
  | "CASH_FULL"
  | "CASH_PARTIAL"
  | "MIN_HOLD"
  | "BTC_RALLY"
  | "NO_BREAKOUT"
  | "BTC_BEST"
  | "ALT_BREAKOUT"
  | "ALL_NEGATIVE"
  | "";

export type CashTriggerStatus = "FULL" | "PARTIAL" | "NONE";
export type MarketRegime = "CASH_FULL" | "CASH_PARTIAL" | "INVEST" | "NEUTRAL";

export interface StrategySignal {
  date: string;
  action: SignalAction;
  ruleTriggered: RuleTriggered;
  reason: string;
  confidence: number;
  allocationMultiplier: number;
  targetPositions: Partial<Record<Asset, number>>;
  momentumScores: Partial<Record<Asset, number>>;
  momentumRanked: Array<{ asset: Asset; score: number }>;
  btcDrawdown: number;
  btc30dHigh: number;
  btcRallying: boolean;
  cashTriggerStatus: CashTriggerStatus;
  marketRegime: MarketRegime;
  reentry: ReentryTrigger;
  assetMetrics: Partial<Record<Asset, AssetMetrics>>;
  // Derived
  partialTriggerPrice: number;
  fullTriggerPrice: number;
  compositeScore: number;
}

export interface DashboardState {
  signal: StrategySignal | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  rawData: Partial<Record<Asset, OHLCVRow[]>>;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, limit = 100): Promise<OHLCVRow[]> {
  const url = `${BINANCE_API}?symbol=${symbol}USDT&interval=1d&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error for ${symbol}: ${res.status}`);
  const raw: string[][] = await res.json();

  // Remove incomplete (current) candle — last candle close_time in future
  const now = Date.now();
  const rows: OHLCVRow[] = raw
    .filter((r) => Number(r[6]) < now) // close_time < now
    .map((r) => ({
      date: new Date(Number(r[0])).toISOString().slice(0, 10),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }));

  return rows;
}

// ── Indicator calculations ─────────────────────────────────────────────────────

function calcMomentum30(rows: OHLCVRow[]): number {
  if (rows.length < MOMENTUM_PERIOD + 1) return 0;
  const current = rows[rows.length - 1].close;
  const prev = rows[rows.length - 1 - MOMENTUM_PERIOD].close;
  return ((current / prev) - 1) * 100;
}

function calcHigh30(rows: OHLCVRow[]): number {
  const slice = rows.slice(-HIGH_LOOKBACK);
  return Math.max(...slice.map((r) => r.close));
}

function calcDrawdown30(rows: OHLCVRow[]): number {
  const high = calcHigh30(rows);
  const current = rows[rows.length - 1].close;
  return (high - current) / high;
}

function calcBtcRallying(rows: OHLCVRow[]): boolean {
  // BTC made a new 30-day closing high in the last BTC_NEW_HIGH_DAYS days
  const recent = rows.slice(-BTC_NEW_HIGH_DAYS);
  const priorHigh = calcHigh30(rows.slice(0, rows.length - BTC_NEW_HIGH_DAYS));
  return recent.some((r) => r.close >= priorHigh);
}

function isNearBreakout(rows: OHLCVRow[]): boolean {
  const high = calcHigh30(rows);
  const current = rows[rows.length - 1].close;
  return (high - current) / high <= BREAKOUT_THRESHOLD;
}

function calc24hChange(rows: OHLCVRow[]): number {
  if (rows.length < 2) return 0;
  const cur = rows[rows.length - 1].close;
  const prev = rows[rows.length - 2].close;
  return ((cur / prev) - 1) * 100;
}

// ── Re-entry trigger ───────────────────────────────────────────────────────────

function calcReentry(btcRows: OHLCVRow[]): ReentryTrigger {
  if (btcRows.length < MOMENTUM_PERIOD + 8) {
    return { triggerPrice: 0, currentBtcPrice: 0, gapUsd: 0, gapPct: 0, alreadyMet: false, rollingTriggers: [] };
  }

  const currentPrice = btcRows[btcRows.length - 1].close;
  // Trigger = close from exactly MOMENTUM_PERIOD days ago
  const triggerPrice = btcRows[btcRows.length - 1 - MOMENTUM_PERIOD].close;
  const alreadyMet = currentPrice > triggerPrice;
  const gapUsd = currentPrice - triggerPrice;
  const gapPct = ((currentPrice / triggerPrice) - 1) * 100;

  // Rolling 7-day thresholds
  const rollingTriggers: ReentryRolling[] = [];
  for (let d = 1; d <= 7; d++) {
    const idx = btcRows.length - 1 - MOMENTUM_PERIOD + d;
    if (idx >= 0 && idx < btcRows.length) {
      const tp = btcRows[idx].close;
      rollingTriggers.push({
        daysFromNow: d,
        triggerPrice: tp,
        deltaVsTodayUsd: tp - triggerPrice,
        deltaVsTodayPct: ((tp / triggerPrice) - 1) * 100,
      });
    }
  }

  return { triggerPrice, currentBtcPrice: currentPrice, gapUsd, gapPct, alreadyMet, rollingTriggers };
}

// ── Signal generation ──────────────────────────────────────────────────────────

function generateSignal(
  data: Partial<Record<Asset, OHLCVRow[]>>
): StrategySignal {
  const today = new Date().toISOString().slice(0, 10);

  // Compute metrics for each asset
  const assetMetrics: Partial<Record<Asset, AssetMetrics>> = {};
  const momentumScores: Partial<Record<Asset, number>> = {};

  for (const asset of MAJORS) {
    const rows = data[asset];
    if (!rows || rows.length < MOMENTUM_PERIOD + 1) continue;

    const momentum30 = calcMomentum30(rows);
    const high30 = calcHigh30(rows);
    const drawdown30 = calcDrawdown30(rows);
    const nearHigh = isNearBreakout(rows);
    const btcRallying = asset === "BTC" ? calcBtcRallying(rows) : false;
    const priceChange24h = calc24hChange(rows);

    assetMetrics[asset] = {
      asset,
      currentPrice: rows[rows.length - 1].close,
      momentum30,
      high30,
      drawdown30,
      nearHigh,
      btcRallying,
      priceChange24h,
    };
    momentumScores[asset] = momentum30;
  }

  const btcMetrics = assetMetrics["BTC"];
  const btcDrawdown = btcMetrics?.drawdown30 ?? 0;
  const btc30dHigh = btcMetrics?.high30 ?? 0;
  const btcRallying = btcMetrics?.btcRallying ?? false;
  const btcRows = data["BTC"] ?? [];
  const reentry = calcReentry(btcRows);

  const partialTriggerPrice = btc30dHigh * (1 - CASH_PARTIAL_THRESHOLD);
  const fullTriggerPrice = btc30dHigh * (1 - CASH_FULL_THRESHOLD);

  // Ranked momentum
  const momentumRanked = (Object.entries(momentumScores) as [Asset, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([asset, score]) => ({ asset, score }));

  const bestAsset = momentumRanked[0]?.asset ?? "BTC";
  const bestScore = momentumRanked[0]?.score ?? 0;

  // Cash trigger status
  let cashTriggerStatus: CashTriggerStatus = "NONE";
  let allocationMultiplier = 1.0;
  if (btcDrawdown >= CASH_FULL_THRESHOLD) {
    cashTriggerStatus = "FULL";
    allocationMultiplier = 0.0;
  } else if (btcDrawdown >= CASH_PARTIAL_THRESHOLD) {
    cashTriggerStatus = "PARTIAL";
    allocationMultiplier = 0.5;
  }

  const marketRegime: MarketRegime =
    cashTriggerStatus === "FULL"
      ? "CASH_FULL"
      : cashTriggerStatus === "PARTIAL"
      ? "CASH_PARTIAL"
      : allocationMultiplier === 1.0
      ? "INVEST"
      : "NEUTRAL";

  // ── Decision flow ──────────────────────────────────────────────────────────
  let action: SignalAction = "HOLD";
  let ruleTriggered: RuleTriggered = "";
  let reason = "";
  let targetPositions: Partial<Record<Asset, number>> = {};
  let confidence = 0;

  if (cashTriggerStatus === "FULL") {
    action = "SELL_ALL";
    ruleTriggered = "CASH_FULL";
    reason = `BTC down ${(btcDrawdown * 100).toFixed(1)}% from 30-day high — full cash`;
    targetPositions = {};
  } else {
    if (bestAsset === "BTC") {
      if (bestScore > 0) {
        action = "BUY";
        ruleTriggered = "BTC_BEST";
        reason = `BTC has best momentum (${bestScore > 0 ? "+" : ""}${bestScore.toFixed(1)}%)`;
        targetPositions = { BTC: allocationMultiplier };
      } else {
        action = "HOLD";
        ruleTriggered = "ALL_NEGATIVE";
        reason = "All assets have negative momentum — stay cash";
        targetPositions = {};
      }
    } else {
      // Alt candidate
      if (btcRallying) {
        ruleTriggered = "BTC_RALLY";
        reason = `BTC rallying — no alts allowed`;
        const btcScore = momentumScores["BTC"] ?? 0;
        targetPositions = btcScore > 0 ? { BTC: allocationMultiplier } : {};
        action = btcScore > 0 ? "BUY" : "HOLD";
      } else if (!assetMetrics[bestAsset]?.nearHigh) {
        ruleTriggered = "NO_BREAKOUT";
        reason = `${bestAsset} not near 30-day high — no breakout`;
        const btcScore = momentumScores["BTC"] ?? 0;
        targetPositions = btcScore > 0 ? { BTC: allocationMultiplier } : {};
        action = btcScore > 0 ? "BUY" : "HOLD";
      } else if (bestScore > 0) {
        ruleTriggered = "ALT_BREAKOUT";
        reason = `${bestAsset} breaking out (${bestScore > 0 ? "+" : ""}${bestScore.toFixed(1)}%)`;
        const cap = PER_ASSET_MAX_CAPS[bestAsset] ?? 1.0;
        const alloc = Math.min(allocationMultiplier, cap);
        targetPositions = { [bestAsset]: alloc } as Partial<Record<Asset, number>>;
        const remainder = allocationMultiplier - alloc;
        if (remainder > 0.01) {
          const btcScore = momentumScores["BTC"] ?? 0;
          if (btcScore > 0) targetPositions["BTC"] = remainder;
        }
        action = "BUY";
      } else {
        ruleTriggered = "ALL_NEGATIVE";
        reason = "All assets have negative momentum — stay cash";
        targetPositions = {};
        action = "HOLD";
      }
    }

    // Confidence
    if (Object.keys(targetPositions).length > 0) {
      const bestTargetScore = Math.max(
        ...Object.keys(targetPositions).map((a) => Math.abs(momentumScores[a as Asset] ?? 0))
      );
      confidence = Math.min(bestTargetScore / 50.0, 1.0);
    }
  }

  const compositeScore = Math.round((1 - btcDrawdown) * 1000) / 1000;

  return {
    date: today,
    action,
    ruleTriggered,
    reason,
    confidence,
    allocationMultiplier,
    targetPositions,
    momentumScores,
    momentumRanked,
    btcDrawdown,
    btc30dHigh,
    btcRallying,
    cashTriggerStatus,
    marketRegime,
    reentry,
    assetMetrics,
    partialTriggerPrice,
    fullTriggerPrice,
    compositeScore,
  };
}

// ── Main hook ──────────────────────────────────────────────────────────────────

export function useBinanceData(refreshIntervalMs = 5 * 60 * 1000): DashboardState {
  const [state, setState] = useState<DashboardState>({
    signal: null,
    loading: true,
    error: null,
    lastUpdated: null,
    rawData: {},
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const results = await Promise.allSettled(
        MAJORS.map((asset) => fetchKlines(asset, 120))
      );

      const rawData: Partial<Record<Asset, OHLCVRow[]>> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled") rawData[MAJORS[i]] = r.value;
      });

      const signal = generateSignal(rawData);
      setState({ signal, loading: false, error: null, lastUpdated: new Date(), rawData });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch data",
      }));
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, refreshIntervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll, refreshIntervalMs]);

  return state;
}

export { MAJORS, PER_ASSET_MAX_CAPS, MOMENTUM_PERIOD, CASH_PARTIAL_THRESHOLD, CASH_FULL_THRESHOLD, MIN_HOLD_DAYS, BTC_NEW_HIGH_DAYS, BREAKOUT_THRESHOLD };
