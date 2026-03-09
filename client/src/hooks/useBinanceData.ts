/*
 * useBinanceData — TREND_CONFIRM Strategy v7.1 Conservative
 * ==========================================================
 * v7.1 changes from v7.0:
 * - SUI/DOGE cap: 60% → 35%
 * - MIN_HOLD_DAYS: 14 → 7
 * - BTC_NEW_HIGH_DAYS: 5 → 3
 * - Confidence zone thresholds updated
 * - NEW Rule 2: Re-entry gate (in_full_cash state before asset ranking)
 * - NEW Rule 3: All-negative exit (7-day whipsaw block, sets in_full_cash)
 * - Rules renumbered: min-hold=4, rally=5, breakout=6
 * - Signal fields: all_negative, all_neg_exits, all_neg_blocked
 *
 * Rule priority: BTC crash > Re-entry gate > All-negative exit > Min-hold > BTC rally > Breakout > Enter/Hold/Rotate
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────
export const MAJORS = ["BTC", "ETH", "SOL", "SUI", "DOGE"] as const;
export type Asset = (typeof MAJORS)[number];

const PAIRS: Record<Asset, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  SUI: "SUIUSDT",
  DOGE: "DOGEUSDT",
};

export const PER_ASSET_CAPS: Record<Asset, number> = {
  BTC: 1.0,
  ETH: 1.0,
  SOL: 1.0,
  SUI: 0.35,   // v7.1: was 0.60
  DOGE: 0.35,  // v7.1: was 0.60
};

export const MOMENTUM_PERIOD = 30;
export const HIGH_LOOKBACK = 30;
export const CASH_PARTIAL_THRESHOLD = 0.12;  // 12%
export const CASH_FULL_THRESHOLD = 0.25;     // 25%
export const MIN_HOLD_DAYS = 7;              // v7.1: was 14
export const BTC_NEW_HIGH_DAYS = 3;          // v7.1: was 5
export const BREAKOUT_THRESHOLD = 0.05;      // within 5% of 30d high
export const LEVERAGE_ENABLED = false;
export const LEVERAGE_MULTIPLIER = 2.0;
export const ALL_NEGATIVE_EXIT_ENABLED = true; // v7.1 addition
export const ALL_NEG_HOLD_BLOCK = 7;           // v7.1: block all-neg exit if held < 7 days

// Confidence Score v3 zone thresholds (v7.1 updated)
export const CONF_ZONE_HIGH = 0.65;        // v7.1: was 0.68
export const CONF_ZONE_MED_HIGH = 0.55;    // unchanged
export const CONF_ZONE_MED = 0.45;         // v7.1: was 0.40
export const CONF_ZONE_MED_LOW = 0.35;     // v7.1: was 0.28

// ── Types ──────────────────────────────────────────────────────────────────────
export interface Candle {
  time: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetMetrics {
  symbol: Asset;
  price: number;
  momentum30: number;        // direct 30-day %
  change24h: number;
  drawdownFromHigh30: number; // negative = below high
  nearHigh30: boolean;       // within 5% of 30d high
  high30: number;
  ma90: number;
  ma200: number;
}

export type CashTriggerStatus = "NONE" | "PARTIAL" | "FULL";

export interface BtcHealth {
  price: number;
  high30d: number;
  drawdownPct: number;       // positive = drawdown (e.g. 15 = 15% below high)
  isRallying: boolean;       // new high in last BTC_NEW_HIGH_DAYS days
  cashTriggerStatus: CashTriggerStatus;
  partialTriggerPrice: number;
  fullTriggerPrice: number;
  allocationMultiplier: number; // 1.0 / 0.5 / 0.0
  allNegative: boolean;      // v7.1: all 5 assets have negative 30d momentum
}

export interface ConfidenceV3 {
  score: number;
  zone: "LOW" | "MEDIUM-LOW" | "MEDIUM" | "MEDIUM-HIGH" | "HIGH";
  fngValue: number;
  fng30dAvg: number;
  sthRatio: number;
  btcAbove200: boolean;
  leverageEnabled: boolean;
  leverageFiring: boolean;
  leverageReason: string;
}

export type RuleTriggered =
  | "CASH_FULL"
  | "CASH_PARTIAL"
  | "REENTRY_GATE"       // v7.1: Rule 2
  | "ALL_NEGATIVE"       // v7.1: Rule 3
  | "ALL_NEGATIVE_BLOCKED" // v7.1: Rule 3 blocked by hold period
  | "MIN_HOLD"           // Rule 4 (was Rule 2)
  | "BTC_RALLY"          // Rule 5 (was Rule 3)
  | "NO_BREAKOUT"        // Rule 6 (was Rule 4)
  | "BTC_BEST"
  | "ALT_BREAKOUT"
  | "HOLD"
  | "";

export interface StrategySignal {
  action: "HOLD" | "BUY" | "SELL_ALL" | "ROTATE" | "REBALANCE";
  targetPositions: Partial<Record<Asset, number>>;
  ruleTriggered: RuleTriggered;
  reason: string;
  leverage: number;
  leverageReason: string;
  topAsset: Asset | null;
  allocationMultiplier: number;
  // Confidence
  confidence: number;
  confidenceZone: ConfidenceV3["zone"];
  // Re-entry
  reentryTriggerPrice: number;
  reentryGapUsd: number;
  reentryGapPct: number;
  reentryAlreadyMet: boolean;
  reentryRolling: Array<{ daysFromNow: number; triggerPrice: number; deltaPct: number; deltaUsd: number }>;
  // Flags
  rotationBlocked: boolean;
  altBlockedRally: boolean;
  altBlockedBreakout: boolean;
  daysHeld: number;
  // v7.1 new fields
  allNegative: boolean;
  allNegExits: number;
  allNegBlocked: number;
  inFullCash: boolean;
  // Legacy fields for Portfolio page compatibility
  momentumScores: Partial<Record<Asset, number>>;
  momentumRanked: Array<{ asset: Asset; score: number }>;
  // BTC metrics (for Portfolio page)
  btcDrawdown: number;
  btc30dHigh: number;
  btcRallying: boolean;
}

export interface ReentryRow {
  symbol: Asset;
  icon: string;
  currentPrice: number;
  triggerToday: number;      // price 30 days ago (today's trigger)
  triggerTomorrow: number;   // price 29 days ago (tomorrow's trigger)
  metToday: boolean;
  metTomorrow: boolean;
  gapTodayPct: number;       // negative = already met
  gapTomorrowPct: number;
}

export interface BinanceDataResult {
  signal: StrategySignal | null;
  assets: Partial<Record<Asset, AssetMetrics>>;
  rankedAssets: Array<{ symbol: Asset; score: number; rank: number }>;
  btcHealth: BtcHealth;
  confidence: ConfidenceV3;
  rawData: Partial<Record<Asset, Candle[]>>;
  reentryTable: ReentryRow[];  // 2-day rolling trigger for all 5 assets
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

// ── Math helpers ───────────────────────────────────────────────────────────────

function calcMomentum(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  const latest = candles[candles.length - 1].close;
  const past = candles[candles.length - 1 - period].close;
  return ((latest / past) - 1) * 100;
}

function calcMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close ?? 0;
  const slice = candles.slice(candles.length - period);
  return slice.reduce((a, c) => a + c.close, 0) / period;
}

// ── Confidence Score v3 ────────────────────────────────────────────────────────

function scoreFng(v: number, avg30d: number): number {
  let base: number;
  if (v < 25) base = 0.10;
  else if (v < 40) base = 0.35;
  else if (v < 55) base = 0.60;
  else if (v < 75) base = 1.00;
  else base = 0.50;
  const trend = v - avg30d;
  if (trend > 20) base = Math.min(1.0, base + 0.12);
  else if (trend > 10) base = Math.min(1.0, base + 0.07);
  else if (trend > 4) base = Math.min(1.0, base + 0.03);
  else if (trend < -20) base = Math.max(0.0, base - 0.12);
  else if (trend < -10) base = Math.max(0.0, base - 0.07);
  else if (trend < -4) base = Math.max(0.0, base - 0.03);
  return Math.round(base * 10000) / 10000;
}

function scoreSth(s: number): number {
  if (s > 1.45) return 0.65;
  if (s > 1.20) return 1.00;
  if (s > 1.08) return 0.92;
  if (s > 0.97) return 0.72;
  if (s > 0.88) return 0.50;
  if (s > 0.75) return 0.25;
  return 0.05;
}

function confidenceZone(score: number): ConfidenceV3["zone"] {
  if (score >= CONF_ZONE_HIGH) return "HIGH";
  if (score >= CONF_ZONE_MED_HIGH) return "MEDIUM-HIGH";
  if (score >= CONF_ZONE_MED) return "MEDIUM";
  if (score >= CONF_ZONE_MED_LOW) return "MEDIUM-LOW";
  return "LOW";
}

// ── BTC Health ────────────────────────────────────────────────────────────────

function deriveBtcHealth(btcCandles: Candle[], momentum30: Partial<Record<Asset, number>>): BtcHealth {
  const allNegative = MAJORS.every(s => (momentum30[s] ?? 0) <= 0);

  if (btcCandles.length < HIGH_LOOKBACK + 1) {
    return { price: 0, high30d: 0, drawdownPct: 0, isRallying: false, cashTriggerStatus: "NONE", partialTriggerPrice: 0, fullTriggerPrice: 0, allocationMultiplier: 1.0, allNegative };
  }
  const latest = btcCandles[btcCandles.length - 1];
  const price = latest.close;
  const high30d = Math.max(...btcCandles.slice(-HIGH_LOOKBACK).map(c => c.high));
  const drawdownPct = high30d > 0 ? ((high30d - price) / high30d) * 100 : 0;

  // BTC rallying: made new high in last BTC_NEW_HIGH_DAYS days (v7.1: 3 days)
  const recentHighs = btcCandles.slice(-BTC_NEW_HIGH_DAYS);
  const prevHigh = btcCandles.length > BTC_NEW_HIGH_DAYS
    ? Math.max(...btcCandles.slice(-(HIGH_LOOKBACK + BTC_NEW_HIGH_DAYS), -BTC_NEW_HIGH_DAYS).map(c => c.high))
    : 0;
  const isRallying = recentHighs.some(c => c.close >= prevHigh);

  let cashTriggerStatus: CashTriggerStatus = "NONE";
  let allocationMultiplier = 1.0;
  if (drawdownPct / 100 >= CASH_FULL_THRESHOLD) {
    cashTriggerStatus = "FULL";
    allocationMultiplier = 0.0;
  } else if (drawdownPct / 100 >= CASH_PARTIAL_THRESHOLD) {
    cashTriggerStatus = "PARTIAL";
    allocationMultiplier = 0.5;
  }

  return {
    price,
    high30d,
    drawdownPct,
    isRallying,
    cashTriggerStatus,
    partialTriggerPrice: high30d * (1 - CASH_PARTIAL_THRESHOLD),
    fullTriggerPrice: high30d * (1 - CASH_FULL_THRESHOLD),
    allocationMultiplier,
    allNegative,
  };
}

// ── Re-entry trigger ──────────────────────────────────────────────────────────

function calcReentry(btcCandles: Candle[]): Pick<StrategySignal, "reentryTriggerPrice" | "reentryGapUsd" | "reentryGapPct" | "reentryAlreadyMet" | "reentryRolling"> {
  const empty = { reentryTriggerPrice: 0, reentryGapUsd: 0, reentryGapPct: 0, reentryAlreadyMet: false, reentryRolling: [] };
  if (btcCandles.length < MOMENTUM_PERIOD + 8) return empty;
  const currentPrice = btcCandles[btcCandles.length - 1].close;
  // trigger = close from 30 days ago (index -(MOMENTUM_PERIOD + 1))
  const triggerPrice = btcCandles[btcCandles.length - (MOMENTUM_PERIOD + 1)].close;
  const gapUsd = triggerPrice - currentPrice;
  const gapPct = (triggerPrice / currentPrice - 1) * 100;
  const alreadyMet = gapPct <= 0;

  const rolling: StrategySignal["reentryRolling"] = [];
  for (let i = 1; i <= 7; i++) {
    const barIdx = btcCandles.length - (MOMENTUM_PERIOD + 1) + i;
    if (barIdx < 0 || barIdx >= btcCandles.length) continue;
    const ft = btcCandles[barIdx].close;
    rolling.push({
      daysFromNow: i,
      triggerPrice: Math.round(ft),
      deltaUsd: Math.round(ft - currentPrice),
      deltaPct: Math.round((ft / currentPrice - 1) * 10000) / 100,
    });
  }
  return { reentryTriggerPrice: Math.round(triggerPrice), reentryGapUsd: Math.round(gapUsd), reentryGapPct: Math.round(gapPct * 100) / 100, reentryAlreadyMet: alreadyMet, reentryRolling: rolling };
}

// ── Signal generation — v7.1 rule order ───────────────────────────────────────
// Rule 1:  BTC crash guard (FULL cash, bypasses hold period)
// Rule 1b: BTC partial cash flag (continue with 50% allocation)
// Rule 2:  Re-entry gate (if in_full_cash, wait for BTC momentum > 0)
// Rule 3:  All-negative exit (7-day block)
// Rule 4:  Minimum hold (7 days, blocks rotation)
// Rule 5:  BTC rally block (3-day window)
// Rule 6:  Breakout confirmation (within 5% of 30d high)
// Rule 7:  Enter / Hold / Rotate

function buildSignal(
  btcHealth: BtcHealth,
  momentum30: Partial<Record<Asset, number>>,
  assets: Partial<Record<Asset, AssetMetrics>>,
  confidence: ConfidenceV3,
  reentry: ReturnType<typeof calcReentry>,
  // v7.1: in_full_cash and hold_days come from persistent state
  // Since we don't have server state, we derive them from market conditions
  inFullCash: boolean,
  daysHeld: number,
): StrategySignal {
  const ranked = MAJORS
    .filter(s => momentum30[s] !== undefined)
    .map(s => ({ symbol: s as Asset, score: momentum30[s]! }))
    .sort((a, b) => b.score - a.score);

  const momentumScores: Partial<Record<Asset, number>> = {};
  ranked.forEach(r => { momentumScores[r.symbol] = r.score; });
  const momentumRanked = ranked.map(r => ({ asset: r.symbol, score: r.score }));

  const allNegative = btcHealth.allNegative;

  const base: Omit<StrategySignal, "action" | "targetPositions" | "ruleTriggered" | "reason" | "topAsset" | "allocationMultiplier" | "rotationBlocked" | "altBlockedRally" | "altBlockedBreakout" | "daysHeld" | "allNegExits" | "allNegBlocked" | "inFullCash"> = {
    leverage: 1.0,
    leverageReason: "Leverage disabled in v7.1 Conservative",
    confidence: confidence.score,
    confidenceZone: confidence.zone,
    ...reentry,
    momentumScores,
    momentumRanked,
    btcDrawdown: btcHealth.drawdownPct / 100,
    btc30dHigh: btcHealth.high30d,
    btcRallying: btcHealth.isRallying,
    allNegative,
  };

  // RULE 1: Full cash trigger — bypasses ALL other rules including hold period
  if (btcHealth.cashTriggerStatus === "FULL") {
    return {
      ...base,
      action: "SELL_ALL",
      targetPositions: {},
      ruleTriggered: "CASH_FULL",
      reason: `BTC down ${btcHealth.drawdownPct.toFixed(1)}% from 30d high — full cash (Rule 1, bypasses hold period)`,
      topAsset: null,
      allocationMultiplier: 0.0,
      rotationBlocked: false,
      altBlockedRally: false,
      altBlockedBreakout: false,
      daysHeld,
      allNegExits: 0,
      allNegBlocked: 0,
      inFullCash: true,
    };
  }

  const allocationMultiplier = btcHealth.allocationMultiplier;

  // RULE 1b: Partial cash — continue to asset selection but with 50% allocation
  const partialNote = btcHealth.cashTriggerStatus === "PARTIAL"
    ? ` (50% allocation — partial cash trigger at ${btcHealth.drawdownPct.toFixed(1)}%)`
    : "";

  // RULE 2: Re-entry gate — if in full cash, wait for BTC 30d momentum to turn positive
  if (inFullCash) {
    const btcMomentum = momentum30["BTC"] ?? 0;
    if (btcMomentum <= 0) {
      return {
        ...base,
        action: "HOLD",
        targetPositions: {},
        ruleTriggered: "REENTRY_GATE",
        reason: `In full cash — waiting for BTC 30d momentum to turn positive (currently ${btcMomentum.toFixed(1)}%). Re-entry trigger: $${reentry.reentryTriggerPrice.toLocaleString()}`,
        topAsset: null,
        allocationMultiplier: 0.0,
        rotationBlocked: false,
        altBlockedRally: false,
        altBlockedBreakout: false,
        daysHeld,
        allNegExits: 0,
        allNegBlocked: 0,
        inFullCash: true,
      };
    }
    // BTC momentum turned positive — clear in_full_cash and continue to asset selection
  }

  if (!ranked.length) {
    return {
      ...base,
      action: "HOLD",
      targetPositions: {},
      ruleTriggered: "ALL_NEGATIVE",
      reason: "No momentum data available",
      topAsset: null,
      allocationMultiplier,
      rotationBlocked: false,
      altBlockedRally: false,
      altBlockedBreakout: false,
      daysHeld,
      allNegExits: 0,
      allNegBlocked: 0,
      inFullCash: false,
    };
  }

  // RULE 3: All-negative exit (v7.1 addition)
  // Only fires if currently holding a position (not in cash already)
  if (ALL_NEGATIVE_EXIT_ENABLED && allNegative && !inFullCash) {
    if (daysHeld < ALL_NEG_HOLD_BLOCK) {
      // Blocked by hold period — whipsaw protection
      return {
        ...base,
        action: "HOLD",
        targetPositions: ranked[0] && ranked[0].score > 0 ? { [ranked[0].symbol]: allocationMultiplier } : {},
        ruleTriggered: "ALL_NEGATIVE_BLOCKED",
        reason: `All 5 assets have negative 30d momentum but hold period not met (${daysHeld}/${ALL_NEG_HOLD_BLOCK} days) — whipsaw block active${partialNote}`,
        topAsset: ranked[0]?.symbol ?? null,
        allocationMultiplier,
        rotationBlocked: true,
        altBlockedRally: false,
        altBlockedBreakout: false,
        daysHeld,
        allNegExits: 0,
        allNegBlocked: 1,
        inFullCash: false,
      };
    }
    // Hold period met — exit to full cash
    return {
      ...base,
      action: "SELL_ALL",
      targetPositions: {},
      ruleTriggered: "ALL_NEGATIVE",
      reason: `All 5 assets have negative 30d momentum and hold period met (${daysHeld} days) — exiting to full cash (Rule 3)`,
      topAsset: null,
      allocationMultiplier: 0.0,
      rotationBlocked: false,
      altBlockedRally: false,
      altBlockedBreakout: false,
      daysHeld,
      allNegExits: 1,
      allNegBlocked: 0,
      inFullCash: true,
    };
  }

  const bestAsset = ranked[0].symbol;
  const bestScore = ranked[0].score;

  // RULE 5: BTC rally block (v7.1: 3-day window, was 5)
  if (bestAsset !== "BTC") {
    if (btcHealth.isRallying) {
      const btcScore = momentum30["BTC"] ?? 0;
      return {
        ...base,
        action: btcScore > 0 ? "BUY" : "HOLD",
        targetPositions: btcScore > 0 ? { BTC: allocationMultiplier } : {},
        ruleTriggered: "BTC_RALLY",
        reason: `BTC rallying (new high in last ${BTC_NEW_HIGH_DAYS} days) — no alts allowed (Rule 5)${partialNote}`,
        topAsset: btcScore > 0 ? "BTC" : null,
        allocationMultiplier,
        rotationBlocked: false,
        altBlockedRally: true,
        altBlockedBreakout: false,
        daysHeld,
        allNegExits: 0,
        allNegBlocked: 0,
        inFullCash: false,
      };
    }

    // RULE 6: Breakout confirmation
    const assetMetric = assets[bestAsset];
    const nearHigh = assetMetric?.nearHigh30 ?? false;
    if (!nearHigh) {
      const btcScore = momentum30["BTC"] ?? 0;
      return {
        ...base,
        action: btcScore > 0 ? "BUY" : "HOLD",
        targetPositions: btcScore > 0 ? { BTC: allocationMultiplier } : {},
        ruleTriggered: "NO_BREAKOUT",
        reason: `${bestAsset} not breaking out (not within ${BREAKOUT_THRESHOLD * 100}% of 30d high) — staying with BTC (Rule 6)${partialNote}`,
        topAsset: btcScore > 0 ? "BTC" : null,
        allocationMultiplier,
        rotationBlocked: false,
        altBlockedRally: false,
        altBlockedBreakout: true,
        daysHeld,
        allNegExits: 0,
        allNegBlocked: 0,
        inFullCash: false,
      };
    }
  }

  // All negative momentum (no positive assets)
  if (bestScore <= 0) {
    return {
      ...base,
      action: "HOLD",
      targetPositions: {},
      ruleTriggered: "ALL_NEGATIVE",
      reason: `All assets have negative 30d momentum${partialNote}`,
      topAsset: bestAsset,
      allocationMultiplier,
      rotationBlocked: false,
      altBlockedRally: false,
      altBlockedBreakout: false,
      daysHeld,
      allNegExits: 0,
      allNegBlocked: 0,
      inFullCash: false,
    };
  }

  // RULE 7: Asset selected — enter / hold / rotate
  const cap = PER_ASSET_CAPS[bestAsset];
  const alloc = Math.min(allocationMultiplier, cap);
  const targetPositions: Partial<Record<Asset, number>> = { [bestAsset]: alloc };

  // Remainder split: if cap < allocationMultiplier and BTC has positive momentum
  const remainder = allocationMultiplier - alloc;
  if (remainder > 0.01 && bestAsset !== "BTC" && (momentum30["BTC"] ?? 0) > 0) {
    targetPositions["BTC"] = remainder;
  }

  const ruleTriggered: RuleTriggered = bestAsset === "BTC" ? "BTC_BEST" : "ALT_BREAKOUT";
  const reason = bestAsset === "BTC"
    ? `BTC best momentum (${bestScore > 0 ? "+" : ""}${bestScore.toFixed(1)}%) — Rule 7${partialNote}`
    : `${bestAsset} breaking out (${bestScore > 0 ? "+" : ""}${bestScore.toFixed(1)}%) — Rule 7${partialNote}`;

  return {
    ...base,
    action: "BUY",
    targetPositions,
    ruleTriggered,
    reason,
    topAsset: bestAsset,
    allocationMultiplier,
    rotationBlocked: false,
    altBlockedRally: false,
    altBlockedBreakout: false,
    daysHeld,
    allNegExits: 0,
    allNegBlocked: 0,
    inFullCash: false,
  };
}

// ── Fear & Greed ───────────────────────────────────────────────────────────────

async function fetchFearAndGreed(): Promise<{ current: number; avg30d: number }> {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=30&format=json");
    const json = await resp.json();
    const data: Array<{ value: string }> = json.data ?? [];
    const current = parseInt(data[0]?.value ?? "50", 10);
    const avg30d = data.length > 1
      ? data.slice(0, 30).reduce((a, d) => a + parseInt(d.value, 10), 0) / Math.min(30, data.length)
      : current;
    return { current, avg30d };
  } catch {
    return { current: 50, avg30d: 50 };
  }
}

// ── Asset icons ──────────────────────────────────────────────────────────────
const ASSET_ICONS_MAP: Record<Asset, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "🌊", DOGE: "Ð",
};

// ── Per-asset 2-day re-entry table ────────────────────────────────────────────
function calcReentryTable(candleMap: Partial<Record<Asset, Candle[]>>): ReentryRow[] {
  return MAJORS.map((symbol) => {
    const candles = candleMap[symbol];
    if (!candles || candles.length < MOMENTUM_PERIOD + 2) {
      return {
        symbol,
        icon: ASSET_ICONS_MAP[symbol],
        currentPrice: 0,
        triggerToday: 0,
        triggerTomorrow: 0,
        metToday: false,
        metTomorrow: false,
        gapTodayPct: 0,
        gapTomorrowPct: 0,
      };
    }
    const currentPrice = candles[candles.length - 1].close;
    const triggerToday = candles[candles.length - 1 - MOMENTUM_PERIOD].close;
    const triggerTomorrow = candles[candles.length - MOMENTUM_PERIOD].close;
    const metToday = currentPrice >= triggerToday;
    const metTomorrow = currentPrice >= triggerTomorrow;
    const gapTodayPct = ((triggerToday - currentPrice) / currentPrice) * 100;
    const gapTomorrowPct = ((triggerTomorrow - currentPrice) / currentPrice) * 100;
    return {
      symbol,
      icon: ASSET_ICONS_MAP[symbol],
      currentPrice,
      triggerToday,
      triggerTomorrow,
      metToday,
      metTomorrow,
      gapTodayPct: Math.round(gapTodayPct * 100) / 100,
      gapTomorrowPct: Math.round(gapTomorrowPct * 100) / 100,
    };
  });
}

// ── Derive in_full_cash from market state ─────────────────────────────────────
// Since we don't have server-side state, we derive in_full_cash from:
// 1. BTC cash trigger FULL was active recently (drawdown ≥ 25%)
// 2. All assets negative (all-neg exit would have fired)
// 3. BTC 30d momentum is negative (re-entry not yet met)
// This is a best-effort approximation for the frontend-only signal display.
function deriveInFullCash(
  btcHealth: BtcHealth,
  momentum30: Partial<Record<Asset, number>>,
): boolean {
  // If BTC crash guard is currently active → in full cash
  if (btcHealth.cashTriggerStatus === "FULL") return true;
  // If BTC 30d momentum is negative and all assets are negative → likely in cash
  const btcMom = momentum30["BTC"] ?? 0;
  if (btcMom <= 0 && btcHealth.allNegative) return true;
  return false;
}

// ── Main hook ──────────────────────────────────────────────────────────────────

const DEFAULT_BTC_HEALTH: BtcHealth = {
  price: 0, high30d: 0, drawdownPct: 0, isRallying: false,
  cashTriggerStatus: "NONE", partialTriggerPrice: 0, fullTriggerPrice: 0, allocationMultiplier: 1.0,
  allNegative: false,
};

const DEFAULT_CONF: ConfidenceV3 = {
  score: 0.5, zone: "MEDIUM", fngValue: 50, fng30dAvg: 50, sthRatio: 1.0,
  btcAbove200: false, leverageEnabled: false, leverageFiring: false, leverageReason: "Leverage disabled in v7.1 Conservative",
};

export function useBinanceData(refreshMs = 5 * 60 * 1000): BinanceDataResult {
  const [result, setResult] = useState<BinanceDataResult>({
    signal: null,
    assets: {},
    rankedAssets: [],
    btcHealth: DEFAULT_BTC_HEALTH,
    confidence: DEFAULT_CONF,
    rawData: {},
    reentryTable: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const now = Date.now();
      const candlePromises = MAJORS.map(async (symbol) => {
        const url = `https://api.binance.com/api/v3/klines?symbol=${PAIRS[symbol]}&interval=1d&limit=220`;
        const resp = await fetch(url);
        const raw: any[][] = await resp.json();
        const candles: Candle[] = raw
          .filter(k => Number(k[6]) < now)
          .map(k => ({
            time: Number(k[0]),
            date: new Date(Number(k[0])).toISOString().slice(0, 10),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
        return { symbol, candles };
      });

      const [candleResults, fng] = await Promise.all([Promise.all(candlePromises), fetchFearAndGreed()]);
      const candleMap: Partial<Record<Asset, Candle[]>> = {};
      candleResults.forEach(({ symbol, candles }) => { candleMap[symbol as Asset] = candles; });

      // Per-asset metrics
      const momentum30: Partial<Record<Asset, number>> = {};
      const assetMetrics: Partial<Record<Asset, AssetMetrics>> = {};

      for (const symbol of MAJORS) {
        const candles = candleMap[symbol];
        if (!candles || candles.length < MOMENTUM_PERIOD + 1) continue;
        const latest = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const mom30 = calcMomentum(candles, MOMENTUM_PERIOD);
        const ma200 = calcMA(candles, Math.min(200, candles.length));
        const ma90 = calcMA(candles, Math.min(90, candles.length));
        const high30 = Math.max(...candles.slice(-HIGH_LOOKBACK).map(c => c.high));
        const drawdownFromHigh30 = ((latest.close - high30) / high30) * 100;
        const change24h = prev ? ((latest.close - prev.close) / prev.close) * 100 : 0;
        const nearHigh30 = (high30 - latest.close) / high30 <= BREAKOUT_THRESHOLD;
        momentum30[symbol] = mom30;
        assetMetrics[symbol] = {
          symbol,
          price: latest.close,
          momentum30: mom30,
          change24h,
          drawdownFromHigh30,
          nearHigh30,
          high30,
          ma90,
          ma200,
        };
      }

      // Ranked by direct 30d momentum
      const ranked = MAJORS
        .filter(s => assetMetrics[s])
        .map(s => ({ symbol: s as Asset, score: momentum30[s]! }))
        .sort((a, b) => b.score - a.score)
        .map((a, i) => ({ ...a, rank: i + 1 }));

      // BTC health (v7.1: pass momentum30 for allNegative flag)
      const btcHealth = deriveBtcHealth(candleMap["BTC"] ?? [], momentum30);

      // Confidence v3
      const btcCandles = candleMap["BTC"] ?? [];
      const btcPrice = btcCandles[btcCandles.length - 1]?.close ?? 0;
      const ma200BTC = calcMA(btcCandles, Math.min(200, btcCandles.length));
      const ma90BTC = calcMA(btcCandles, Math.min(90, btcCandles.length));
      const sthRatio = ma90BTC > 0 ? btcPrice / ma90BTC : 1.0;
      const btcAbove200 = btcPrice > ma200BTC;
      const confScore = Math.round((scoreFng(fng.current, fng.avg30d) * 0.55 + scoreSth(sthRatio) * 0.45) * 10000) / 10000;
      const confidence: ConfidenceV3 = {
        score: confScore,
        zone: confidenceZone(confScore),
        fngValue: fng.current,
        fng30dAvg: fng.avg30d,
        sthRatio,
        btcAbove200,
        leverageEnabled: LEVERAGE_ENABLED,
        leverageFiring: false,
        leverageReason: "Leverage disabled in v7.1 Conservative",
      };

      // Re-entry trigger
      const reentry = calcReentry(btcCandles);

      // Per-asset 2-day re-entry table
      const reentryTable = calcReentryTable(candleMap);

      // Derive in_full_cash state (best-effort from market data)
      const inFullCash = deriveInFullCash(btcHealth, momentum30);

      // Signal (v7.1 rule order, daysHeld=0 as we don't track server state on frontend)
      const signal = buildSignal(btcHealth, momentum30, assetMetrics, confidence, reentry, inFullCash, 0);

      setResult({
        signal,
        assets: assetMetrics,
        rankedAssets: ranked,
        btcHealth,
        confidence,
        rawData: candleMap,
        reentryTable,
        loading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err: any) {
      setResult(prev => ({ ...prev, loading: false, error: err?.message ?? "Fetch error" }));
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, refreshMs);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll, refreshMs]);

  return result;
}
