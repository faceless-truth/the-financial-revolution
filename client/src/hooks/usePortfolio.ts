/**
 * usePortfolio — Real forward-tracking portfolio hook
 *
 * Starts from TODAY (first visit) with $50,000 in cash.
 * State is persisted in localStorage so it survives page refreshes.
 * Each day at 00:30 UTC, the user executes the strategy signal.
 * The equity curve grows forward from Day 1 (today) with one point per day.
 *
 * Day 1: $50,000 cash — no trades yet, waiting for first 00:30 UTC execution.
 * Each subsequent day: the signal from the previous daily close is applied.
 */

import { useMemo } from "react";
import type { Candle, StrategySignal } from "./useBinanceData";

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
  btcHoldValue: number;
  inCash: boolean;
  asset: string;
}

export interface PortfolioState {
  startingCapital: number;
  startDate: string;
  currentValue: number;
  cashBalance: number;
  investedValue: number;
  currentAsset: string;
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
  btcHoldValue: number;
  btcStartPrice: number;
  outperformanceUsd: number;
  outperformancePct: number;
  minHoldDaysRemaining: number;
  nextActionDate: string;
  todaySignal: StrategySignal | null;
  daysTracked: number;
  loading: boolean;
}

const STARTING_CAPITAL = 71_400;
const ACTUAL_ENTRY_PRICE = 67_000;  // Actual BTC purchase price on Day 1
const ACTUAL_ENTRY_DATE = "2026-03-08"; // Actual purchase date
const MIN_HOLD_DAYS = 14;
const STORAGE_KEY = "tfr_portfolio_v4";

type Asset = "BTC" | "ETH" | "SOL" | "SUI" | "DOGE";

// ── Persisted state shape ──────────────────────────────────────────────────────
interface PersistedPortfolio {
  startDate: string;           // ISO date string of Day 1
  btcStartPrice: number;       // BTC price on Day 1 for buy-and-hold comparison
  cash: number;
  heldAsset: string;
  heldUnits: number;
  entryPrice: number;
  entryDate: string;
  daysHeld: number;
  tradeLog: TradeEntry[];
  equityCurve: DailyEquityPoint[];
  lastProcessedDate: string;   // last date we applied a signal for
}

function loadPersistedPortfolio(): PersistedPortfolio | null {
  try {
    // Clear any old versions — v4 is a fresh start with actual trade data
    localStorage.removeItem("tfr_portfolio_v1");
    localStorage.removeItem("tfr_portfolio_v2");
    localStorage.removeItem("tfr_portfolio_v3");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedPortfolio;
  } catch {
    return null;
  }
}

function savePersistedPortfolio(p: PersistedPortfolio): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Execution window check removed — signal is always valid once computed from daily close.

export function usePortfolio(
  signal: StrategySignal | null,
  rawData: Partial<Record<Asset, Candle[]>>
): PortfolioState {
  const portfolio = useMemo<PortfolioState>(() => {
    const today = todayUTC();
    const btcRows = rawData["BTC"] ?? [];
    const btcCurrentPrice = btcRows.length > 0 ? btcRows[btcRows.length - 1].close : 0;

    // ── Load or initialise persisted state ────────────────────────────────────
    let persisted = loadPersistedPortfolio();

    if (!persisted) {
      // Day 1 — seed with actual trade: BTC purchased at ACTUAL_ENTRY_PRICE on ACTUAL_ENTRY_DATE
      const btcUnits = STARTING_CAPITAL / ACTUAL_ENTRY_PRICE;
      const initialValue = btcUnits * (btcCurrentPrice > 0 ? btcCurrentPrice : ACTUAL_ENTRY_PRICE);
      const btcHoldValueDay1 = STARTING_CAPITAL; // same as starting capital since we bought BTC on Day 1
      persisted = {
        startDate: ACTUAL_ENTRY_DATE,
        btcStartPrice: ACTUAL_ENTRY_PRICE, // BTC price we paid — used for buy-and-hold comparison
        cash: 0,                           // fully invested
        heldAsset: "BTC",
        heldUnits: btcUnits,
        entryPrice: ACTUAL_ENTRY_PRICE,
        entryDate: ACTUAL_ENTRY_DATE,
        daysHeld: 0,
        tradeLog: [
          {
            date: ACTUAL_ENTRY_DATE,
            action: "BUY",
            asset: "BTC",
            price: ACTUAL_ENTRY_PRICE,
            units: btcUnits,
            valueUsd: STARTING_CAPITAL,
            reason: "Strategy signal: BUY BTC 100% — 30d momentum positive, breakout confirmed",
            portfolioValueAfter: initialValue,
          },
        ],
        equityCurve: [
          {
            date: ACTUAL_ENTRY_DATE,
            value: STARTING_CAPITAL,
            btcHoldValue: btcHoldValueDay1,
            inCash: false,
            asset: "BTC",
          },
        ],
        lastProcessedDate: today, // already applied — don't re-process today
      };
      savePersistedPortfolio(persisted);
    }

    // ── Apply today's signal if not yet applied today ─────────────────────────
    if (
      signal &&
      btcCurrentPrice > 0 &&
      persisted.lastProcessedDate !== today
    ) {
      // Determine target from signal
      const targetEntries = Object.entries(signal.targetPositions) as [Asset, number][];
      const targetAsset = targetEntries.length > 0 ? targetEntries[0][0] : "CASH";
      const targetAlloc = targetEntries.length > 0 ? targetEntries[0][1] : 0;

      const shouldChange = targetAsset !== persisted.heldAsset;
      const canTrade =
        persisted.daysHeld >= MIN_HOLD_DAYS || persisted.heldAsset === "CASH";

      if (shouldChange && canTrade) {
        // Sell current position
        if (persisted.heldAsset !== "CASH" && persisted.heldUnits > 0) {
          const assetRows = rawData[persisted.heldAsset as Asset] ?? [];
          const sellPrice =
            assetRows.length > 0
              ? assetRows[assetRows.length - 1].close
              : persisted.entryPrice;
          const proceeds = persisted.heldUnits * sellPrice;
          persisted.cash += proceeds;

          persisted.tradeLog.push({
            date: today,
            action: "SELL",
            asset: persisted.heldAsset,
            price: sellPrice,
            units: persisted.heldUnits,
            valueUsd: proceeds,
            reason: signal.reason,
            portfolioValueAfter: persisted.cash,
          });

          persisted.heldUnits = 0;
          persisted.heldAsset = "CASH";
          persisted.daysHeld = 0;
        }

        // Buy new position
        if (targetAsset !== "CASH" && targetAlloc > 0) {
          const assetRows = rawData[targetAsset as Asset] ?? [];
          const buyPrice =
            assetRows.length > 0 ? assetRows[assetRows.length - 1].close : 0;
          if (buyPrice > 0) {
            const investAmount = persisted.cash * targetAlloc;
            const units = investAmount / buyPrice;
            persisted.cash -= investAmount;
            persisted.heldAsset = targetAsset;
            persisted.heldUnits = units;
            persisted.entryPrice = buyPrice;
            persisted.entryDate = today;
            persisted.daysHeld = 0;

            persisted.tradeLog.push({
              date: today,
              action: "BUY",
              asset: targetAsset,
              price: buyPrice,
              units,
              valueUsd: investAmount,
              reason: signal.reason,
              portfolioValueAfter: persisted.cash + units * buyPrice,
            });
          }
        }
      } else if (persisted.heldAsset !== "CASH") {
        persisted.daysHeld++;
      }

      // Add today's equity point
      let portfolioValue = persisted.cash;
      if (persisted.heldAsset !== "CASH" && persisted.heldUnits > 0) {
        const assetRows = rawData[persisted.heldAsset as Asset] ?? [];
        const livePrice =
          assetRows.length > 0
            ? assetRows[assetRows.length - 1].close
            : persisted.entryPrice;
        portfolioValue = persisted.cash + persisted.heldUnits * livePrice;
      }

      const btcHoldValue =
        persisted.btcStartPrice > 0
          ? STARTING_CAPITAL * (btcCurrentPrice / persisted.btcStartPrice)
          : STARTING_CAPITAL;

      // Only add a new point if we don't already have one for today
      const lastPoint = persisted.equityCurve[persisted.equityCurve.length - 1];
      if (!lastPoint || lastPoint.date !== today) {
        persisted.equityCurve.push({
          date: today,
          value: Math.round(portfolioValue * 100) / 100,
          btcHoldValue: Math.round(btcHoldValue * 100) / 100,
          inCash: persisted.heldAsset === "CASH",
          asset: persisted.heldAsset,
        });
      }

      persisted.lastProcessedDate = today;
      savePersistedPortfolio(persisted);
    }

    // ── Live mark-to-market (intraday) ────────────────────────────────────────
    let investedValue = 0;
    if (persisted.heldAsset !== "CASH" && persisted.heldUnits > 0) {
      const assetRows = rawData[persisted.heldAsset as Asset] ?? [];
      const livePrice =
        assetRows.length > 0
          ? assetRows[assetRows.length - 1].close
          : persisted.entryPrice;
      investedValue = persisted.heldUnits * livePrice;
    }

    const currentValue = persisted.cash + investedValue;

    const btcHoldValue =
      persisted.btcStartPrice > 0
        ? STARTING_CAPITAL * (btcCurrentPrice / persisted.btcStartPrice)
        : STARTING_CAPITAL;

    const totalPnlUsd = currentValue - STARTING_CAPITAL;
    const totalPnlPct = (totalPnlUsd / STARTING_CAPITAL) * 100;

    const unrealisedPnlUsd =
      investedValue > 0 && persisted.entryPrice > 0
        ? investedValue - persisted.heldUnits * persisted.entryPrice
        : 0;
    const unrealisedPnlPct =
      persisted.entryPrice > 0 && persisted.heldUnits > 0
        ? ((investedValue / (persisted.heldUnits * persisted.entryPrice)) - 1) * 100
        : 0;

    const minHoldDaysRemaining = Math.max(0, MIN_HOLD_DAYS - persisted.daysHeld);

    // Next 00:05 UTC
    const now = new Date();
    const nextExec = new Date(now);
    nextExec.setUTCHours(0, 5, 0, 0);
    if (nextExec <= now) nextExec.setUTCDate(nextExec.getUTCDate() + 1);

    const outperformanceUsd = currentValue - btcHoldValue;
    const outperformancePct = btcHoldValue > 0
      ? ((currentValue / btcHoldValue) - 1) * 100
      : 0;

    // Days tracked = number of calendar days since start
    const msPerDay = 1000 * 60 * 60 * 24;
    const startMs = new Date(persisted.startDate).getTime();
    const daysTracked = Math.max(1, Math.round((Date.now() - startMs) / msPerDay) + 1);

    // Build a live-updated equity curve — update today's last point with current value
    const liveEquityCurve = [...persisted.equityCurve];
    if (liveEquityCurve.length > 0) {
      const last = liveEquityCurve[liveEquityCurve.length - 1];
      if (last.date === today) {
        liveEquityCurve[liveEquityCurve.length - 1] = {
          ...last,
          value: Math.round(currentValue * 100) / 100,
          btcHoldValue: Math.round(btcHoldValue * 100) / 100,
        };
      }
    }

    return {
      startingCapital: STARTING_CAPITAL,
      startDate: persisted.startDate,
      currentValue,
      cashBalance: persisted.cash,
      investedValue,
      currentAsset: persisted.heldAsset,
      currentUnits: persisted.heldUnits,
      entryPrice: persisted.entryPrice,
      entryDate: persisted.entryDate,
      daysHeld: persisted.daysHeld,
      unrealisedPnlUsd,
      unrealisedPnlPct,
      totalPnlUsd,
      totalPnlPct,
      tradeLog: persisted.tradeLog,
      equityCurve: liveEquityCurve,
      btcHoldValue,
      btcStartPrice: persisted.btcStartPrice,
      outperformanceUsd,
      outperformancePct,
      minHoldDaysRemaining,
      nextActionDate: nextExec.toISOString(),
      todaySignal: signal,
      daysTracked,
      loading: btcCurrentPrice === 0,
    };
  }, [signal, rawData]);

  return portfolio;
}

/**
 * Reset the portfolio back to Day 1 ($50k cash, today).
 * Call this from a UI button.
 */
export function resetPortfolio(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
