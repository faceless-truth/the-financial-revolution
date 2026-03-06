/**
 * usePortfolio — Forward portfolio simulation hook
 *
 * Simulates a $50,000 portfolio starting TODAY following The Financial Revolution strategy.
 * Execution assumed at 00:30 UTC daily (after daily candle close).
 *
 * Logic:
 *   - Start: today, $50,000 cash
 *   - Each day: evaluate signal from daily close, execute at next open (approximated)
 *   - Track: portfolio value, current position, P&L, days held, trade log
 *   - Live value: if currently invested, mark-to-market using latest price from Binance
 */

import { useEffect, useMemo, useState } from "react";
import type { OHLCVRow, StrategySignal } from "./useBinanceData";

export interface TradeEntry {
  date: string;
  action: string;
  asset: string;
  price: number;
  units: number;
  valueUsd: number;
  reason: string;
  portfolioValueAfter: number;
}

export interface DailyEquityPoint {
  date: string;
  value: number;
  btcHoldValue: number;   // what $50k in BTC would be worth
  inCash: boolean;
  asset: string;
}

export interface PortfolioState {
  startingCapital: number;
  currentValue: number;
  cashBalance: number;
  investedValue: number;
  currentAsset: string;          // "CASH" or asset name
  currentUnits: number;
  entryPrice: number;
  entryDate: string;
  daysHeld: number;
  unrealisedPnlUsd: number;
  unrealisedPnlPct: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  tradeLog: TradeEntry[];
  equityCurve: DailyEquityPoint[];
  btcHoldValue: number;          // BTC buy-and-hold comparison
  outperformanceUsd: number;
  outperformancePct: number;
  minHoldDaysRemaining: number;
  nextActionDate: string;        // next 00:30 UTC execution window
  todaySignal: StrategySignal | null;
  loading: boolean;
}

const STARTING_CAPITAL = 50_000;
const MIN_HOLD_DAYS = 14;
const BINANCE_API = "https://api.binance.com/api/v3/klines";
const MAJORS = ["BTC", "ETH", "SOL", "SUI", "DOGE"] as const;
type Asset = typeof MAJORS[number];

async function fetchKlines(symbol: string, limit = 120): Promise<OHLCVRow[]> {
  const url = `${BINANCE_API}?symbol=${symbol}USDT&interval=1d&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${symbol}: ${res.status}`);
  const raw: string[][] = await res.json();
  const now = Date.now();
  return raw
    .filter((r) => Number(r[6]) < now)
    .map((r) => ({
      date: new Date(Number(r[0])).toISOString().slice(0, 10),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }));
}

// Strategy parameters (mirrors useBinanceData)
const MOMENTUM_PERIOD = 30;
const HIGH_LOOKBACK = 30;
const CASH_PARTIAL = 0.12;
const CASH_FULL = 0.25;
const BTC_NEW_HIGH_DAYS = 5;
const BREAKOUT_THRESHOLD = 0.05;
const PER_ASSET_MAX_CAPS: Record<string, number> = {
  BTC: 1.0, ETH: 1.0, SOL: 1.0, SUI: 0.6, DOGE: 0.6,
};

function calcMomentum(rows: OHLCVRow[], period = MOMENTUM_PERIOD): number {
  if (rows.length < period + 1) return 0;
  const cur = rows[rows.length - 1].close;
  const prev = rows[rows.length - 1 - period].close;
  return ((cur / prev) - 1) * 100;
}

function calcHigh(rows: OHLCVRow[], lookback = HIGH_LOOKBACK): number {
  return Math.max(...rows.slice(-lookback).map((r) => r.close));
}

function calcDrawdown(rows: OHLCVRow[]): number {
  const high = calcHigh(rows);
  const cur = rows[rows.length - 1].close;
  return (high - cur) / high;
}

function calcBtcRallying(rows: OHLCVRow[]): boolean {
  const recent = rows.slice(-BTC_NEW_HIGH_DAYS);
  const priorHigh = calcHigh(rows.slice(0, rows.length - BTC_NEW_HIGH_DAYS));
  return recent.some((r) => r.close >= priorHigh);
}

function isNearHigh(rows: OHLCVRow[]): boolean {
  const high = calcHigh(rows);
  const cur = rows[rows.length - 1].close;
  return (high - cur) / high <= BREAKOUT_THRESHOLD;
}

interface DaySignal {
  date: string;
  action: "BUY" | "SELL" | "HOLD";
  asset: string;
  alloc: number;
  price: number;
  reason: string;
}

/**
 * Replay the strategy over historical data to build an equity curve.
 * We start from the FIRST day we have enough data (30+ candles) and
 * simulate forward to today.
 */
function replayStrategy(
  rawData: Partial<Record<Asset, OHLCVRow[]>>,
  startingCapital: number
): {
  equityCurve: DailyEquityPoint[];
  tradeLog: TradeEntry[];
  finalCash: number;
  currentAsset: string;
  currentUnits: number;
  entryPrice: number;
  entryDate: string;
  daysHeld: number;
  btcStartPrice: number;
} {
  const btcRows = rawData["BTC"] ?? [];
  if (btcRows.length < MOMENTUM_PERIOD + 5) {
    return {
      equityCurve: [],
      tradeLog: [],
      finalCash: startingCapital,
      currentAsset: "CASH",
      currentUnits: 0,
      entryPrice: 0,
      entryDate: "",
      daysHeld: 0,
      btcStartPrice: 0,
    };
  }

  // We start simulation from the first day we have enough data
  // Use last 60 days of available data for the simulation window
  const simDays = Math.min(60, btcRows.length - MOMENTUM_PERIOD - 1);
  const startIdx = btcRows.length - simDays;
  const btcStartPrice = btcRows[startIdx].close;

  let cash = startingCapital;
  let heldAsset = "CASH";
  let heldUnits = 0;
  let entryPrice = 0;
  let entryDate = "";
  let daysHeld = 0;

  const equityCurve: DailyEquityPoint[] = [];
  const tradeLog: TradeEntry[] = [];

  for (let i = startIdx; i < btcRows.length; i++) {
    const date = btcRows[i].date;

    // Build per-asset slice up to day i
    const slices: Partial<Record<Asset, OHLCVRow[]>> = {};
    for (const asset of MAJORS) {
      const rows = rawData[asset];
      if (!rows) continue;
      // Find rows up to and including this date
      const idx = rows.findIndex((r) => r.date === date);
      if (idx >= MOMENTUM_PERIOD) {
        slices[asset] = rows.slice(0, idx + 1);
      }
    }

    const btcSlice = slices["BTC"] ?? [];
    if (btcSlice.length < MOMENTUM_PERIOD + 1) continue;

    // Compute strategy signal for this day
    const btcDrawdown = calcDrawdown(btcSlice);
    const btcRallying = calcBtcRallying(btcSlice);

    const momentumScores: Partial<Record<Asset, number>> = {};
    for (const asset of MAJORS) {
      const s = slices[asset];
      if (s && s.length >= MOMENTUM_PERIOD + 1) {
        momentumScores[asset] = calcMomentum(s);
      }
    }

    const ranked = (Object.entries(momentumScores) as [Asset, number][])
      .sort((a, b) => b[1] - a[1]);

    const bestAsset = ranked[0]?.[0] ?? "BTC";
    const bestScore = ranked[0]?.[1] ?? 0;

    let allocationMultiplier = 1.0;
    let targetAsset = "CASH";
    let targetAlloc = 0;
    let signalReason = "";

    if (btcDrawdown >= CASH_FULL) {
      targetAsset = "CASH";
      targetAlloc = 0;
      allocationMultiplier = 0;
      signalReason = `Full cash — BTC down ${(btcDrawdown * 100).toFixed(1)}%`;
    } else {
      if (btcDrawdown >= CASH_PARTIAL) {
        allocationMultiplier = 0.5;
      }

      if (bestScore <= 0) {
        targetAsset = "CASH";
        targetAlloc = 0;
        signalReason = "All negative momentum — cash";
      } else if (bestAsset === "BTC") {
        targetAsset = "BTC";
        targetAlloc = allocationMultiplier;
        signalReason = `BTC best momentum +${bestScore.toFixed(1)}%`;
      } else if (btcRallying) {
        const btcScore = momentumScores["BTC"] ?? 0;
        targetAsset = btcScore > 0 ? "BTC" : "CASH";
        targetAlloc = btcScore > 0 ? allocationMultiplier : 0;
        signalReason = `BTC rallying — no alts`;
      } else {
        const altSlice = slices[bestAsset as Asset];
        if (altSlice && isNearHigh(altSlice)) {
          const cap = PER_ASSET_MAX_CAPS[bestAsset] ?? 1.0;
          targetAlloc = Math.min(allocationMultiplier, cap);
          targetAsset = bestAsset;
          signalReason = `${bestAsset} breakout +${bestScore.toFixed(1)}%`;
        } else {
          const btcScore = momentumScores["BTC"] ?? 0;
          targetAsset = btcScore > 0 ? "BTC" : "CASH";
          targetAlloc = btcScore > 0 ? allocationMultiplier : 0;
          signalReason = `${bestAsset} no breakout — fallback`;
        }
      }
    }

    // Current portfolio value before any trade
    let currentValue = cash;
    if (heldAsset !== "CASH" && heldUnits > 0) {
      const assetRows = slices[heldAsset as Asset];
      const livePrice = assetRows ? assetRows[assetRows.length - 1].close : 0;
      currentValue = cash + heldUnits * livePrice;
    }

    // Execute trade if signal changed AND min-hold respected
    const shouldChange = targetAsset !== heldAsset;
    const canTrade = daysHeld >= MIN_HOLD_DAYS || heldAsset === "CASH";

    if (shouldChange && canTrade) {
      // Sell current position
      if (heldAsset !== "CASH" && heldUnits > 0) {
        const assetRows = slices[heldAsset as Asset];
        const sellPrice = assetRows ? assetRows[assetRows.length - 1].close : 0;
        const proceeds = heldUnits * sellPrice;
        cash += proceeds;

        tradeLog.push({
          date,
          action: "SELL",
          asset: heldAsset,
          price: sellPrice,
          units: heldUnits,
          valueUsd: proceeds,
          reason: signalReason,
          portfolioValueAfter: cash,
        });
        heldUnits = 0;
        heldAsset = "CASH";
        daysHeld = 0;
      }

      // Buy new position
      if (targetAsset !== "CASH" && targetAlloc > 0) {
        const assetRows = slices[targetAsset as Asset];
        const buyPrice = assetRows ? assetRows[assetRows.length - 1].close : 0;
        if (buyPrice > 0) {
          const investAmount = cash * targetAlloc;
          const units = investAmount / buyPrice;
          cash -= investAmount;
          heldAsset = targetAsset;
          heldUnits = units;
          entryPrice = buyPrice;
          entryDate = date;
          daysHeld = 0;

          tradeLog.push({
            date,
            action: "BUY",
            asset: targetAsset,
            price: buyPrice,
            units,
            valueUsd: investAmount,
            reason: signalReason,
            portfolioValueAfter: cash + units * buyPrice,
          });
        }
      }
    } else if (heldAsset !== "CASH") {
      daysHeld++;
    }

    // Mark-to-market for equity curve
    let portfolioValue = cash;
    if (heldAsset !== "CASH" && heldUnits > 0) {
      const assetRows = slices[heldAsset as Asset];
      const livePrice = assetRows ? assetRows[assetRows.length - 1].close : 0;
      portfolioValue = cash + heldUnits * livePrice;
    }

    // BTC buy-and-hold value
    const btcCurrentPrice = btcSlice[btcSlice.length - 1].close;
    const btcHoldValue = startingCapital * (btcCurrentPrice / btcStartPrice);

    equityCurve.push({
      date,
      value: Math.round(portfolioValue * 100) / 100,
      btcHoldValue: Math.round(btcHoldValue * 100) / 100,
      inCash: heldAsset === "CASH",
      asset: heldAsset,
    });
  }

  return {
    equityCurve,
    tradeLog,
    finalCash: cash,
    currentAsset: heldAsset,
    currentUnits: heldUnits,
    entryPrice,
    entryDate,
    daysHeld,
    btcStartPrice,
  };
}

export function usePortfolio(signal: StrategySignal | null, rawData: Partial<Record<Asset, OHLCVRow[]>>): PortfolioState {
  const [loading, setLoading] = useState(true);

  const portfolio = useMemo<PortfolioState>(() => {
    if (!signal || Object.keys(rawData).length === 0) {
      return {
        startingCapital: STARTING_CAPITAL,
        currentValue: STARTING_CAPITAL,
        cashBalance: STARTING_CAPITAL,
        investedValue: 0,
        currentAsset: "CASH",
        currentUnits: 0,
        entryPrice: 0,
        entryDate: "",
        daysHeld: 0,
        unrealisedPnlUsd: 0,
        unrealisedPnlPct: 0,
        totalPnlUsd: 0,
        totalPnlPct: 0,
        tradeLog: [],
        equityCurve: [],
        btcHoldValue: STARTING_CAPITAL,
        outperformanceUsd: 0,
        outperformancePct: 0,
        minHoldDaysRemaining: 0,
        nextActionDate: "",
        todaySignal: signal,
        loading: true,
      };
    }

    const {
      equityCurve,
      tradeLog,
      finalCash,
      currentAsset,
      currentUnits,
      entryPrice,
      entryDate,
      daysHeld,
      btcStartPrice,
    } = replayStrategy(rawData as Partial<Record<Asset, OHLCVRow[]>>, STARTING_CAPITAL);

    // Live mark-to-market
    const btcRows = rawData["BTC"] ?? [];
    const btcCurrentPrice = btcRows.length > 0 ? btcRows[btcRows.length - 1].close : 0;
    const btcHoldValue = btcStartPrice > 0
      ? STARTING_CAPITAL * (btcCurrentPrice / btcStartPrice)
      : STARTING_CAPITAL;

    let investedValue = 0;
    let cashBalance = finalCash;

    if (currentAsset !== "CASH" && currentUnits > 0) {
      const assetRows = rawData[currentAsset as Asset] ?? [];
      const livePrice = assetRows.length > 0 ? assetRows[assetRows.length - 1].close : entryPrice;
      investedValue = currentUnits * livePrice;
    }

    const currentValue = cashBalance + investedValue;
    const totalPnlUsd = currentValue - STARTING_CAPITAL;
    const totalPnlPct = (totalPnlUsd / STARTING_CAPITAL) * 100;

    const unrealisedPnlUsd = investedValue > 0 && entryPrice > 0
      ? investedValue - (currentUnits * entryPrice)
      : 0;
    const unrealisedPnlPct = entryPrice > 0 && currentUnits > 0
      ? ((investedValue / (currentUnits * entryPrice)) - 1) * 100
      : 0;

    const minHoldDaysRemaining = Math.max(0, MIN_HOLD_DAYS - daysHeld);

    // Next execution window: next 00:30 UTC
    const now = new Date();
    const nextExec = new Date(now);
    nextExec.setUTCHours(0, 30, 0, 0);
    if (nextExec <= now) nextExec.setUTCDate(nextExec.getUTCDate() + 1);
    const nextActionDate = nextExec.toISOString();

    const outperformanceUsd = currentValue - btcHoldValue;
    const outperformancePct = ((currentValue / btcHoldValue) - 1) * 100;

    return {
      startingCapital: STARTING_CAPITAL,
      currentValue,
      cashBalance,
      investedValue,
      currentAsset,
      currentUnits,
      entryPrice,
      entryDate,
      daysHeld,
      unrealisedPnlUsd,
      unrealisedPnlPct,
      totalPnlUsd,
      totalPnlPct,
      tradeLog,
      equityCurve,
      btcHoldValue,
      outperformanceUsd,
      outperformancePct,
      minHoldDaysRemaining,
      nextActionDate,
      todaySignal: signal,
      loading: false,
    };
  }, [signal, rawData]);

  useEffect(() => {
    if (portfolio.equityCurve.length > 0) setLoading(false);
  }, [portfolio]);

  return { ...portfolio, loading };
}
