/**
 * Pure helpers for the Bull Rotation Cockpit. No I/O, no React.
 *
 * Every figure comes from the Python-emitted public payload or the private
 * owner-only /api/bybit/performance route. Helpers only select, format and
 * describe. Account dollars stay in decimal arithmetic end to end so venue
 * values never pick up float drift; floats are used only for chart geometry.
 */
import Decimal from "decimal.js";
import {
  PERIOD_KEYS,
  type AccountPerformance,
  type PeriodKey,
  type StrategyCurve,
} from "@shared/cockpit";

const D = Decimal.clone({ precision: 60 });

// ── Formatting ───────────────────────────────────────────────────────────────
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const MINUS = "−";

/** "$12,345" from a decimal string or number. Null/invalid renders "—". */
export function formatUsd(value: string | number | null | undefined, places = 0): string {
  const d = toDecimal(value);
  if (!d) return "—";
  const [int, frac] = d.abs().toFixed(places).split(".");
  const text = `$${group(int)}${frac ? `.${frac}` : ""}`;
  return d.isNegative() && !d.abs().toFixed(places).match(/^[0.]+$/) ? `${MINUS}${text}` : text;
}

/** Signed dollars: "+$1,234", "−$567", "$0". */
export function formatSignedUsd(value: string | number | null | undefined, places = 0): string {
  const d = toDecimal(value);
  if (!d) return "—";
  const rounded = d.toDecimalPlaces(places);
  const body = formatUsd(rounded.abs().toFixed(places), places);
  if (rounded.isZero()) return body;
  return `${rounded.isNegative() ? MINUS : "+"}${body}`;
}

export function formatPct(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${Math.abs(value).toFixed(places)}%`;
}

/** Prices span BTC near $84,000 and DOGE near $0.10, so precision scales. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const dp = Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 100 ? 2 : 4;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export const toneOf = (v: string | number | null | undefined): "up" | "down" | "" => {
  const d = toDecimal(v);
  if (!d || d.isZero()) return "";
  return d.isNegative() ? "down" : "up";
};

function toDecimal(value: string | number | null | undefined): Decimal | null {
  if (value == null) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  try {
    const d = new D(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

// ── Dates (all strategy days are UTC calendar days) ─────────────────────────
export function addDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { month: "short", year: "2-digit", timeZone: "UTC" });

// ── Payload shapes the Cockpit reads (loose: the payload is authoritative) ──
export interface AssetRow {
  price?: number; score?: number; mom_30?: number; mom_14?: number; mom_7?: number; dd_30?: number;
}
export interface CockpitStatus {
  position?: string;
  invested?: boolean;
  entry_price?: number;
  entry_date?: string;
  hold_days?: number;
  action?: string;
  reason?: string;
  portfolio_value_usd?: number;
  reserve_usd?: number;
  total_wealth_usd?: number;
  regime?: { btc_mom_30?: number; btc_price?: number; regime_conf?: number; bull_regime?: boolean };
  assets?: Record<string, AssetRow>;
}
export interface CockpitParams {
  stop_loss_pct?: number;
  crash_dd_threshold?: number;
  min_hold_days?: number;
  regime_exit_threshold?: number;
  rotation_threshold?: number;
  msb_wait_limit?: number;
}
export interface ForecastCondition { label: string; detail: string; distance_pct: number | null }
export interface CockpitForecast { mode?: string; headline?: string; conditions?: ForecastCondition[]; eta?: string }

// ── What ends this trade ─────────────────────────────────────────────────────
export type ExitKind = "stop" | "structure" | "regime" | "crash";
export interface ExitRule {
  kind: ExitKind;
  name: string;
  live: boolean;              // can fire today
  armsOn: string | null;      // UTC date it becomes live, when gated by the minimum hold
  destination: "BTC" | "CASH";
  level: number | null;       // price for stop/structure, percent for regime/crash
  now: number | null;         // same unit as level
  unit: "price" | "pct";
  detail: string;             // payload's own sentence
}
export interface ExitModel {
  asset: string;
  lastClose: number | null;
  entry: number | null;
  minHold: { done: number; required: number; armsOn: string | null; met: boolean };
  rules: ExitRule[];
}

const findCondition = (conds: ForecastCondition[], re: RegExp) => conds.find(c => re.test(c.label.toLowerCase()));

/**
 * Derive the four exits from the payload. Levels come from the emitted
 * parameters (stop), the forecast's distance from the last close (structure),
 * and BTC's emitted momentum and drawdown (regime, crash). Where each exit
 * sends the money follows the v5.0 rules: from an altcoin, a stop or a
 * structure break moves to BTC; a regime or crash exit moves to cash.
 */
export function deriveExits(status: CockpitStatus, params: CockpitParams, forecast: CockpitForecast): ExitModel | null {
  const asset = status.position;
  if (!asset || asset === "CASH") return null;
  const conds = forecast.conditions ?? [];
  const lastClose = status.assets?.[asset]?.price ?? null;
  const entry = status.entry_price ?? null;
  const required = params.min_hold_days ?? 7;
  const done = status.hold_days ?? 0;
  const met = done >= required;
  const armsOn = status.entry_date ? addDays(status.entry_date, required) : null;
  const gatedArms = met ? null : armsOn;
  const btc = status.assets?.BTC ?? {};
  const fromAlt = asset !== "BTC";

  const stopPct = params.stop_loss_pct;
  const stopCond = findCondition(conds, /stop/);
  let stop: number | null = null;
  if (entry != null && stopPct != null) stop = entry * (1 - stopPct);
  else if (lastClose != null && stopCond?.distance_pct != null) stop = lastClose * (1 + stopCond.distance_pct / 100);

  const structCond = findCondition(conds, /structure/);
  const structure = lastClose != null && structCond?.distance_pct != null
    ? lastClose * (1 + structCond.distance_pct / 100) : null;

  const regimeCond = findCondition(conds, /regime/);
  const crashCond = findCondition(conds, /crash/);
  const crashPct = params.crash_dd_threshold != null ? -params.crash_dd_threshold * 100 : null;

  return {
    asset, lastClose, entry,
    minHold: { done, required, armsOn, met },
    rules: [
      { kind: "stop", name: "Stop-loss", live: true, armsOn: null, destination: fromAlt ? "BTC" : "CASH",
        level: stop, now: lastClose, unit: "price", detail: stopCond?.detail ?? "" },
      { kind: "structure", name: "Structure break", live: met, armsOn: gatedArms, destination: fromAlt ? "BTC" : "CASH",
        level: structure, now: lastClose, unit: "price", detail: structCond?.detail ?? "" },
      { kind: "regime", name: "Market regime", live: met, armsOn: gatedArms, destination: "CASH",
        level: params.regime_exit_threshold ?? null, now: btc.mom_30 ?? null, unit: "pct", detail: regimeCond?.detail ?? "" },
      { kind: "crash", name: "Crash backstop", live: true, armsOn: null, destination: "CASH",
        level: crashPct, now: btc.dd_30 != null ? btc.dd_30 * 100 : null, unit: "pct", detail: crashCond?.detail ?? "" },
    ],
  };
}

/** The section headline for "What ends this trade", written from state. */
export function exitHeadline(model: ExitModel | null): string {
  if (!model) return "Nothing to exit. The strategy is in cash.";
  const live = model.rules.filter(r => r.live);
  if (live.length === model.rules.length) return "Four ways out. All four are live.";
  const names = live.map(r => r.name.toLowerCase());
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const until = model.minHold.armsOn ? ` until ${shortDate(model.minHold.armsOn)}` : "";
  return `Four ways out. Only the ${list} ${live.length === 1 ? "is" : "are"} live${until}.`;
}

/** Page title for the Overview. */
export function overviewTitle(status: CockpitStatus | null | undefined): string {
  const pos = status?.position;
  if (!pos) return "Strategy status unavailable";
  if (pos === "CASH") return "You're in cash";
  return `You're holding ${pos}`;
}

/** Plain sentence under the rotation chart. */
export function rotationNote(status: CockpitStatus, params: CockpitParams): string {
  const assets = status.assets ?? {};
  const btc = assets.BTC?.score;
  const threshold = params.rotation_threshold ?? 30;
  if (btc == null) return "Momentum scores are unavailable for this decision.";
  const line = btc + threshold;
  const pos = status.position ?? "CASH";
  const alts = Object.entries(assets)
    .filter(([a, r]) => a !== "BTC" && (r.score ?? 0) > 0)
    .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
  const leader = alts[0];
  if (pos === "CASH") {
    return "In cash, the strategy first waits for BTC's 30-day trend to turn positive and a bullish structure break before buying. The rotation line applies once it holds a position.";
  }
  const minHold = params.min_hold_days ?? 7;
  const held = status.hold_days ?? 0;
  const gate = held < minHold ? `Rotation checks resume after the ${minHold}-day minimum hold (day ${held} now). ` : "";
  if (!leader) return `${gate}No altcoin has a positive momentum score, so there is nothing to rotate into.`;
  const [name, row] = leader;
  const score = row.score ?? 0;
  if (name === pos) {
    const next = alts[1];
    const tail = next ? ` The next strongest, ${next[0]} (${next[1].score!.toFixed(1)}), would need to overtake ${pos} and clear ${line.toFixed(1)}.` : "";
    return `${gate}${pos} still ranks first at ${score.toFixed(1)}, so there is no rotation signal.${tail}`;
  }
  if (score >= line) return `${gate}${name} ranks first at ${score.toFixed(1)} and clears the line at ${line.toFixed(1)}. It would be the rotation target at the next eligible close.`;
  return `${gate}${name} ranks first at ${score.toFixed(1)}, ${(line - score).toFixed(1)} points short of the rotation line at ${line.toFixed(1)}.`;
}

// ── Performance (dollars only) ───────────────────────────────────────────────
export interface PerfPoint { date: string; value: number }
export interface PerfPeriod {
  key: PeriodKey;
  startDate: string;
  endDate: string;
  start: string;        // decimal strings
  end: string;
  change: string;       // excludes deposits/withdrawals for the account
  flows: string | null; // account only
}
export interface PerfModel {
  source: "account" | "strategy";
  title: string;
  subtitle: string;
  points: PerfPoint[];
  flows: Record<string, string>;         // date → net flow (account only)
  exact: Record<string, string>;         // date → exact decimal value
  periods: Partial<Record<PeriodKey, PerfPeriod | null>>;
  notes: string[];
  asOf: string | null;
  /** Account only: an older complete result is shown while a newer one syncs. */
  refreshing?: boolean;
}

export type SessionState = { authenticated: boolean; login_configured?: boolean } | null;

/**
 * Pick the Performance source. The owner's own account only when the
 * server says the session is authenticated AND the private route returned a
 * usable series; otherwise the public $10,000 strategy curve.
 */
export function choosePerformanceSource(
  session: SessionState,
  account: AccountPerformance | null | undefined,
  curve: StrategyCurve | null | undefined,
): "account" | "strategy" | "none" {
  if (session?.authenticated && account?.available && account.series.length > 1) return "account";
  if (curve?.available && curve.series.length > 1) return "strategy";
  return "none";
}

export function accountModel(p: AccountPerformance): PerfModel {
  const periods: PerfModel["periods"] = {};
  for (const key of PERIOD_KEYS) {
    const src = p.periods[key];
    periods[key] = src ? {
      key, startDate: src.start_date, endDate: p.series[p.series.length - 1]?.date ?? src.start_date,
      start: src.start_equity_usd, end: src.end_equity_usd, change: src.pnl_usd, flows: src.net_flows_usd,
    } : null;
  }
  const flows: Record<string, string> = {};
  const exact: Record<string, string> = {};
  for (const pt of p.series) { flows[pt.date] = pt.net_flow_usd; exact[pt.date] = pt.equity_usd; }
  return {
    source: "account",
    title: "Your Bybit account",
    subtitle: "Whole account, including any cash held outside the strategy. Deposits and withdrawals are excluded from gains.",
    points: p.series.map(pt => ({ date: pt.date, value: Number(pt.equity_usd) })),
    flows, exact, periods,
    notes: p.coverage.complete ? [] : p.coverage.notes,
    asOf: p.as_of,
    refreshing: p.refreshing === true,
  };
}

export function strategyModel(c: StrategyCurve): PerfModel {
  const periods: PerfModel["periods"] = {};
  for (const key of PERIOD_KEYS) {
    const src = c.periods[key];
    periods[key] = src ? {
      key, startDate: src.start_date, endDate: c.end_date ?? src.start_date,
      start: String(src.start_usd), end: String(src.end_usd), change: String(src.change_usd), flows: null,
    } : null;
  }
  return {
    source: "strategy",
    title: `${formatUsd(c.basis_usd)} following the strategy`,
    subtitle: c.method,
    points: c.series.map(pt => ({ date: pt.date, value: pt.value_usd })),
    flows: {}, exact: Object.fromEntries(c.series.map(pt => [pt.date, String(pt.value_usd)])),
    periods, notes: [], asOf: c.end_date,
  };
}

/** Points inside a period, inclusive of its start day. */
export function periodPoints(model: PerfModel, period: PerfPeriod): PerfPoint[] {
  return model.points.filter(p => p.date >= period.startDate && p.date <= period.endDate);
}

/**
 * Change since the period start for each point, excluding external flows
 * after the start day (a deposit never reads as a gain). Decimal strings.
 */
export function changesSinceStart(model: PerfModel, period: PerfPeriod): Record<string, string> {
  const out: Record<string, string> = {};
  const start = new D(period.start);
  let flows = new D(0);
  for (const p of periodPoints(model, period)) {
    if (p.date > period.startDate && model.flows[p.date]) flows = flows.plus(model.flows[p.date]);
    const value = model.exact[p.date] != null ? new D(model.exact[p.date]) : new D(p.value);
    out[p.date] = value.minus(start).minus(flows).toString();
  }
  return out;
}

/** Dollars below the running peak of the flow-adjusted curve (≤ 0). */
export function dollarsBelowPeak(changes: number[]): number[] {
  let peak = -Infinity;
  return changes.map(v => { peak = Math.max(peak, v); return v - peak; });
}

export const PERIOD_LABEL: Record<PeriodKey, { tile: string; phrase: string }> = {
  "7D": { tile: "Last 7 days", phrase: "over the last 7 days" },
  "30D": { tile: "Last 30 days", phrase: "over the last 30 days" },
  "6M": { tile: "Last 6 months", phrase: "over the last 6 months" },
  "12M": { tile: "Last 12 months", phrase: "over the last 12 months" },
  All: { tile: "All time", phrase: "all time" },
};

/** Default range: the longest available of 12M, then All, then shorter. */
export function defaultPeriod(model: PerfModel): PeriodKey | null {
  for (const k of ["12M", "All", "6M", "30D", "7D"] as PeriodKey[]) if (model.periods[k]) return k;
  return null;
}

// ── Trades ───────────────────────────────────────────────────────────────────
export const EXIT_NAMES: Record<string, string> = {
  REGIME_EXIT: "Regime exit", ROTATE: "Rotated", STOP_CASH: "Stop-loss", STOP_TO_BTC: "Stop-loss",
  MSB_EXIT: "Structure break", CRASH_EXIT: "Crash backstop",
};
export const exitName = (action: string | null | undefined) =>
  action ? EXIT_NAMES[action] ?? action.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase()) : "—";

// ── Freshness ────────────────────────────────────────────────────────────────
/**
 * The daily decision is dated the UTC day it runs (00:05). A payload is stale
 * once a newer decision should exist: two or more days old, or one day old
 * after 01:00 UTC (the run plus the payload job have had ample time).
 */
export function isStale(asOfDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!asOfDate) return true;
  const today = now.toISOString().slice(0, 10);
  const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86_400_000);
  if (age >= 2) return true;
  return age === 1 && now.getUTCHours() >= 1;
}

export const ACTION_LABELS: Record<string, string> = {
  HOLD: "Held", ROTATE: "Rotated", REENTER_BTC: "Bought BTC", MSB_ENTRY_BTC: "Bought BTC on breakout",
  HOLD_CASH: "Stayed in cash", REGIME_EXIT: "Regime exit", STOP_CASH: "Stop-loss", STOP_TO_BTC: "Stop-loss to BTC",
  MSB_EXIT: "Structure exit", CRASH_EXIT: "Crash exit",
};
export const actionLabel = (a: string | null | undefined) => (a ? ACTION_LABELS[a] ?? exitName(a) : "—");

/** Per-viewer theme choice, shared by the Cockpit and the SMSF page. */
export const THEME_KEY = "cockpit-theme";

export function readTheme(): "light" | "dark" | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}
