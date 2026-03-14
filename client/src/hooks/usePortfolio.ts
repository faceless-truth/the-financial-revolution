/**
 * usePortfolio — Portfolio state derived from actual logged trades + live prices.
 *
 * Source of truth:
 * 1. Starting capital is fixed.
 * 2. Manual trade logs determine whether the user is currently in CASH or invested.
 * 3. Live Binance prices mark the active position to market in real time.
 *
 * This keeps the Portfolio page aligned with the user's real executions rather than
 * a separate simulated state machine.
 */

import { useMemo } from "react";
import type { Candle, StrategySignal } from "./useBinanceData";
import { tradeStore } from "@/lib/tradeStore";

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
const DEFAULT_START_DATE = "2026-03-08";
const MIN_HOLD_DAYS = 7;

type Asset = "BTC" | "ETH" | "SOL" | "SUI" | "DOGE";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function getLivePrice(asset: string, rawData: Partial<Record<Asset, Candle[]>>): number {
  if (asset === "CASH") return 1;
  const rows = rawData[asset as Asset] ?? [];
  return rows.length > 0 ? rows[rows.length - 1].close : 0;
}

function dateOnlyFromExecutedAt(executedAt: number): string {
  return new Date(executedAt).toISOString().slice(0, 10);
}

function normaliseSignalAction(action: string): string {
  return String(action || "").toUpperCase();
}

function inferTargetAsset(tradeType: "buy" | "sell", asset: string, signalAction: string): string {
  const normalizedAsset = String(asset || "CASH").toUpperCase();
  const normalizedSignal = normaliseSignalAction(signalAction);
  if (tradeType === "sell" && (normalizedSignal === "SELL_ALL" || normalizedAsset === "CASH")) {
    return "CASH";
  }
  return normalizedAsset;
}

export function usePortfolio(
  signal: StrategySignal | null,
  rawData: Partial<Record<Asset, Candle[]>>
): PortfolioState {
  const portfolio = useMemo<PortfolioState>(() => {
    const today = todayUTC();
    const manualTrades = tradeStore
      .getAll(1000)
      .slice()
      .sort((a, b) => a.executedAt - b.executedAt);

    const btcCurrentPrice = getLivePrice("BTC", rawData);
    const btcStartPrice = manualTrades.find((t) => t.asset === "BTC" && t.tradeType === "buy")?.price
      ?? btcCurrentPrice
      ?? 0;

    let cash = STARTING_CAPITAL;
    let heldAsset = "CASH";
    let heldUnits = 0;
    let entryPrice = 0;
    let entryDate = DEFAULT_START_DATE;
    let daysHeld = 0;

    const tradeLog: TradeEntry[] = [];
    const equityCurve: DailyEquityPoint[] = [];

    const startDate = manualTrades.length > 0
      ? dateOnlyFromExecutedAt(manualTrades[0].executedAt)
      : DEFAULT_START_DATE;

    if (manualTrades.length === 0) {
      const btcHoldValue = btcStartPrice > 0 && btcCurrentPrice > 0
        ? round2(STARTING_CAPITAL * (btcCurrentPrice / btcStartPrice))
        : STARTING_CAPITAL;

      equityCurve.push({
        date: startDate,
        value: STARTING_CAPITAL,
        btcHoldValue,
        inCash: true,
        asset: "CASH",
      });
    }

    for (const trade of manualTrades) {
      const tradeDate = dateOnlyFromExecutedAt(trade.executedAt);
      const targetAsset = inferTargetAsset(trade.tradeType, trade.asset, trade.signalAction);
      const tradeValue = heldAsset !== "CASH" ? heldUnits * trade.price : cash;

      if (trade.tradeType === "buy") {
        cash = 0;
        heldAsset = targetAsset;
        heldUnits = trade.price > 0 ? tradeValue / trade.price : 0;
        entryPrice = trade.price;
        entryDate = tradeDate;
      } else {
        if (heldAsset !== "CASH" && heldUnits > 0) {
          cash = heldUnits * trade.price;
        }
        heldAsset = "CASH";
        heldUnits = 0;
        entryPrice = 0;
        entryDate = tradeDate;
      }

      const portfolioValueAfter = heldAsset === "CASH"
        ? cash
        : heldUnits * trade.price;

      tradeLog.push({
        date: tradeDate,
        action: trade.tradeType.toUpperCase(),
        asset: targetAsset,
        price: trade.price,
        units: heldUnits,
        valueUsd: round2(portfolioValueAfter),
        reason: trade.notes?.trim() || `${trade.signalAction} logged manually`,
        portfolioValueAfter: round2(portfolioValueAfter),
      });

      const btcHoldValueAtPoint = btcStartPrice > 0 && btcCurrentPrice > 0
        ? round2(STARTING_CAPITAL * (btcCurrentPrice / btcStartPrice))
        : STARTING_CAPITAL;

      const lastPoint = equityCurve[equityCurve.length - 1];
      if (lastPoint?.date === tradeDate) {
        equityCurve[equityCurve.length - 1] = {
          date: tradeDate,
          value: round2(portfolioValueAfter),
          btcHoldValue: btcHoldValueAtPoint,
          inCash: heldAsset === "CASH",
          asset: heldAsset,
        };
      } else {
        equityCurve.push({
          date: tradeDate,
          value: round2(portfolioValueAfter),
          btcHoldValue: btcHoldValueAtPoint,
          inCash: heldAsset === "CASH",
          asset: heldAsset,
        });
      }
    }

    const livePrice = getLivePrice(heldAsset, rawData);
    const investedValue = heldAsset !== "CASH" && heldUnits > 0 && livePrice > 0
      ? heldUnits * livePrice
      : 0;
    const currentValue = round2(cash + investedValue);
    const unrealisedPnlUsd = heldAsset !== "CASH" && heldUnits > 0 && entryPrice > 0
      ? round2(investedValue - heldUnits * entryPrice)
      : 0;
    const unrealisedPnlPct = heldAsset !== "CASH" && heldUnits > 0 && entryPrice > 0
      ? ((livePrice / entryPrice) - 1) * 100
      : 0;

    const totalPnlUsd = round2(currentValue - STARTING_CAPITAL);
    const totalPnlPct = (totalPnlUsd / STARTING_CAPITAL) * 100;
    const btcHoldValue = btcStartPrice > 0 && btcCurrentPrice > 0
      ? round2(STARTING_CAPITAL * (btcCurrentPrice / btcStartPrice))
      : STARTING_CAPITAL;
    const outperformanceUsd = round2(currentValue - btcHoldValue);
    const outperformancePct = btcHoldValue > 0 ? ((currentValue / btcHoldValue) - 1) * 100 : 0;

    if (heldAsset !== "CASH" && entryDate) {
      const start = new Date(entryDate).getTime();
      const end = Date.now();
      daysHeld = Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
    }

    const msPerDay = 1000 * 60 * 60 * 24;
    const startMs = new Date(startDate).getTime();
    const daysTracked = Math.max(1, Math.round((Date.now() - startMs) / msPerDay) + 1);

    const now = new Date();
    const nextExec = new Date(now);
    nextExec.setUTCHours(0, 5, 0, 0);
    if (nextExec <= now) nextExec.setUTCDate(nextExec.getUTCDate() + 1);

    if (equityCurve.length > 0) {
      const last = equityCurve[equityCurve.length - 1];
      if (last.date === today || manualTrades.length > 0) {
        equityCurve[equityCurve.length - 1] = {
          ...last,
          value: currentValue,
          btcHoldValue,
          inCash: heldAsset === "CASH",
          asset: heldAsset,
        };
      }
    }

    return {
      startingCapital: STARTING_CAPITAL,
      startDate,
      currentValue,
      cashBalance: round2(cash),
      investedValue: round2(investedValue),
      currentAsset: heldAsset,
      currentUnits: heldUnits,
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
      btcStartPrice,
      outperformanceUsd,
      outperformancePct,
      minHoldDaysRemaining: Math.max(0, MIN_HOLD_DAYS - daysHeld),
      nextActionDate: nextExec.toISOString(),
      todaySignal: signal,
      daysTracked,
      loading: btcCurrentPrice === 0,
    };
  }, [signal, rawData]);

  return portfolio;
}

export function resetPortfolio(): void {
  localStorage.removeItem("tfr_trades_v1");
  localStorage.removeItem("tfr_portfolio_v1");
  localStorage.removeItem("tfr_portfolio_v2");
  localStorage.removeItem("tfr_portfolio_v3");
  localStorage.removeItem("tfr_portfolio_v5");
  window.location.reload();
}
