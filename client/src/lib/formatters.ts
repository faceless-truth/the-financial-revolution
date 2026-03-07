/**
 * Formatting utilities for The Financial Revolution dashboard
 * v7.0 — Unified Momentum Strategy
 */

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

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
