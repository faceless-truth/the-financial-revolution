/**
 * Formatting utilities for the TREND_CONFIRM dashboard
 */

import type { SignalAction, CashTriggerStatus, MarketRegime } from "@/hooks/useBinanceData";

export function formatPrice(n: number, decimals = 0): string {
  if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: decimals });
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}

export function formatPct(n: number, sign = true): string {
  const s = n.toFixed(1) + "%";
  return sign && n > 0 ? "+" + s : s;
}

export function formatLargeNumber(n: number): string {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

export function signalActionLabel(action: SignalAction): string {
  const map: Record<SignalAction, string> = {
    BUY: "BUY",
    SELL_ALL: "SELL ALL",
    ROTATE: "ROTATE",
    REBALANCE: "REBALANCE",
    HOLD: "HOLD",
  };
  return map[action] ?? action;
}

export function signalActionClass(action: SignalAction): string {
  switch (action) {
    case "BUY": return "signal-buy";
    case "SELL_ALL": return "signal-sell";
    case "ROTATE": return "signal-rotate";
    case "REBALANCE": return "signal-caution";
    case "HOLD": return "signal-hold";
    default: return "signal-hold";
  }
}

export function cashTriggerClass(status: CashTriggerStatus): string {
  switch (status) {
    case "FULL": return "signal-sell";
    case "PARTIAL": return "signal-caution";
    case "NONE": return "signal-buy";
  }
}

export function regimeLabel(regime: MarketRegime): string {
  switch (regime) {
    case "CASH_FULL": return "FULL CASH";
    case "CASH_PARTIAL": return "PARTIAL CASH";
    case "INVEST": return "FULLY INVESTED";
    case "NEUTRAL": return "NEUTRAL";
  }
}

export function regimeClass(regime: MarketRegime): string {
  switch (regime) {
    case "CASH_FULL": return "signal-sell";
    case "CASH_PARTIAL": return "signal-caution";
    case "INVEST": return "signal-buy";
    case "NEUTRAL": return "signal-hold";
  }
}

export function momentumClass(score: number): string {
  if (score > 10) return "text-emerald-400";
  if (score > 0) return "text-emerald-300";
  if (score > -10) return "text-amber-400";
  return "text-red-400";
}

export function drawdownClass(drawdown: number): string {
  if (drawdown >= 0.25) return "text-red-400";
  if (drawdown >= 0.12) return "text-amber-400";
  return "text-emerald-400";
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
