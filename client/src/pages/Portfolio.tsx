import { useState, useEffect, useMemo } from "react";
import { formatLargeNumber, formatPct, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import BybitAccount from "@/components/BybitAccount";
import { Link } from "wouter";
import {
  TrendingUp,
  DollarSign,
  Clock,
  ArrowUpRight,
  Activity,
  Shield,
  BarChart2,
  Zap,
  Layers,
  ArrowUp,
  ArrowDown,
  Minus,
  Bell,
  BellOff,
} from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// ── Asset palette ─────────────────────────────────────────────────────────────

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

function toneColor(tone: "good" | "warn" | "danger" | "neutral") {
  switch (tone) {
    case "good":   return "oklch(0.72 0.18 155)";
    case "warn":   return "oklch(0.78 0.18 75)";
    case "danger": return "oklch(0.62 0.22 25)";
    default:       return "oklch(0.60 0.22 255)";
  }
}

function msbToneColor(tone: string) {
  switch (tone) {
    case "bullish": return "oklch(0.72 0.18 155)";
    case "bearish": return "oklch(0.62 0.22 25)";
    default:        return "oklch(0.60 0.22 255)";
  }
}

function structureColor(structure: string) {
  switch (structure) {
    case "UPTREND":     return "oklch(0.72 0.18 155)";
    case "DOWNTREND":   return "oklch(0.62 0.22 25)";
    case "CONTRACTING": return "oklch(0.78 0.18 75)";
    case "EXPANDING":   return "oklch(0.82 0.18 95)";
    default:            return "oklch(0.60 0.22 255)";
  }
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // Auto-detect decimal places: sub-$1 assets (DOGE, SUI) need 4 decimals;
  // $1–$999 assets need 2 decimals; $1000+ assets need 0 decimals
  const abs = Math.abs(value);
  const decimals = abs < 1 ? 4 : abs < 1000 ? 2 : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

function formatUsdPrecise(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: color ? `${color}25` : undefined }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon && <span className="opacity-50">{icon}</span>}
      </div>
      <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: color ?? "white" }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60 mono-data">{sub}</p>}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>{children}</h2>
    </div>
  );
}

// ── MSB Signal Card ───────────────────────────────────────────────────────────

type MsbAssetSignal = {
  asset: string;
  currentPrice: number;
  atr: number;
  signal: string;
  signalLabel: string;
  signalTone: string;
  structure: string;
  structureLabel: string;
  bullishMsb: boolean;
  bearishMsb: boolean;
  lastPivotHigh: { date: string; price: number } | null;
  lastPivotLow:  { date: string; price: number } | null;
  breakoutLevel:  number | null;
  breakdownLevel: number | null;
  distToPhPct: number | null;
  distToPlPct: number | null;
  phTrend: string;
  plTrend: string;
  recentPivotHighs: Array<{ date: string; price: number }>;
  recentPivotLows:  Array<{ date: string; price: number }>;
  color: string;
  icon: string;
};

function MsbAssetCard({ s }: { s: MsbAssetSignal }) {
  const sigColor = msbToneColor(s.signalTone);
  const strColor = structureColor(s.structure);

  const SignalIcon = s.bullishMsb
    ? <ArrowUp size={14} style={{ color: sigColor }} />
    : s.bearishMsb
    ? <ArrowDown size={14} style={{ color: sigColor }} />
    : <Minus size={14} style={{ color: sigColor }} />;

  return (
    <div className="panel p-4 flex flex-col gap-3" style={{ borderColor: `${sigColor}30`, background: `${sigColor}05` }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold" style={{ color: s.color, fontFamily: "Syne, sans-serif" }}>
            {s.icon} {s.asset}
          </span>
          <span className="text-xs mono-data text-muted-foreground">{formatUsd(s.currentPrice)}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: `${sigColor}15`, border: `1px solid ${sigColor}30` }}>
          {SignalIcon}
          <span className="text-xs font-bold" style={{ color: sigColor }}>{s.signal.replace(/_/g, " ")}</span>
        </div>
      </div>

      {/* Signal description */}
      <p className="text-xs text-muted-foreground leading-relaxed">{s.signalLabel}</p>

      {/* Structure */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Structure:</span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${strColor}15`, color: strColor }}>
          {s.structure}
        </span>
        <span className="text-xs text-muted-foreground">{s.structureLabel}</span>
      </div>

      {/* Key levels grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg p-2.5" style={{ background: "oklch(0.72 0.18 155 / 8%)", border: "1px solid oklch(0.72 0.18 155 / 15%)" }}>
          <p className="text-muted-foreground mb-1">Pivot High</p>
          <p className="font-bold mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>
            {s.lastPivotHigh ? formatUsd(s.lastPivotHigh.price) : "—"}
          </p>
          {s.lastPivotHigh && <p className="text-muted-foreground/60">{s.lastPivotHigh.date}</p>}
          {s.distToPhPct != null && (
            <p className="text-muted-foreground/60 mt-0.5">
              {s.distToPhPct > 0 ? `${s.distToPhPct.toFixed(1)}% below` : `${Math.abs(s.distToPhPct).toFixed(1)}% above`}
            </p>
          )}
        </div>
        <div className="rounded-lg p-2.5" style={{ background: "oklch(0.62 0.22 25 / 8%)", border: "1px solid oklch(0.62 0.22 25 / 15%)" }}>
          <p className="text-muted-foreground mb-1">Pivot Low</p>
          <p className="font-bold mono-data" style={{ color: "oklch(0.62 0.22 25)" }}>
            {s.lastPivotLow ? formatUsd(s.lastPivotLow.price) : "—"}
          </p>
          {s.lastPivotLow && <p className="text-muted-foreground/60">{s.lastPivotLow.date}</p>}
          {s.distToPlPct != null && (
            <p className="text-muted-foreground/60 mt-0.5">
              {s.distToPlPct > 0 ? `${s.distToPlPct.toFixed(1)}% above` : `${Math.abs(s.distToPlPct).toFixed(1)}% below`}
            </p>
          )}
        </div>
      </div>

      {/* Breakout / Breakdown levels */}
      {(s.breakoutLevel || s.breakdownLevel) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {s.breakoutLevel && (
            <div className="flex items-center justify-between rounded px-2 py-1.5" style={{ background: "oklch(0.72 0.18 155 / 6%)" }}>
              <span className="text-muted-foreground">Breakout at</span>
              <span className="font-bold mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>{formatUsd(s.breakoutLevel)}</span>
            </div>
          )}
          {s.breakdownLevel && (
            <div className="flex items-center justify-between rounded px-2 py-1.5" style={{ background: "oklch(0.62 0.22 25 / 6%)" }}>
              <span className="text-muted-foreground">Breakdown at</span>
              <span className="font-bold mono-data" style={{ color: "oklch(0.62 0.22 25)" }}>{formatUsd(s.breakdownLevel)}</span>
            </div>
          )}
        </div>
      )}

      {/* Pivot trend arrows */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border/20 pt-2">
        <span>
          HH/LH:{" "}
          <span className="font-semibold" style={{ color: s.phTrend === "rising" ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }}>
            {s.phTrend === "rising" ? "↑ Rising" : s.phTrend === "falling" ? "↓ Falling" : "—"}
          </span>
        </span>
        <span>
          HL/LL:{" "}
          <span className="font-semibold" style={{ color: s.plTrend === "rising" ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }}>
            {s.plTrend === "rising" ? "↑ Rising" : s.plTrend === "falling" ? "↓ Falling" : "—"}
          </span>
        </span>
        <span className="ml-auto text-muted-foreground/50">ATR: {s.atr > 0 ? formatUsdPrecise(s.atr) : "—"}</span>
      </div>

      {/* Recent pivot levels mini-list */}
      {(s.recentPivotHighs.length > 0 || s.recentPivotLows.length > 0) && (
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-border/20 pt-2">
          <div>
            <p className="text-muted-foreground/60 mb-1">Recent Highs</p>
            {s.recentPivotHighs.slice(-3).reverse().map((p, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground/50">{p.date}</span>
                <span className="mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>{formatUsd(p.price)}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-muted-foreground/60 mb-1">Recent Lows</p>
            {s.recentPivotLows.slice(-3).reverse().map((p, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground/50">{p.date}</span>
                <span className="mono-data" style={{ color: "oklch(0.62 0.22 25)" }}>{formatUsd(p.price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type LivePortfolioSnapshot = {
  source?: { root?: string; strategy?: string };
  summary?: {
    fixedCapitalUsd?: number;
    displayedPortfolioValueUsd?: number;
    liveStrategyValueUsd?: number;
    pnlUsd?: number;
    totalReturnPct?: number;
    currentAsset?: string;
    signalAction?: string;
    ruleReason?: string;
    marketRegime?: string;
    regimeConfidence?: string;
    confidenceLabel?: string;
    lastUpdate?: string;
    holdDays?: number;
    entryPrice?: number;
    entryDate?: string;
    // ── v4.1 emitted passthrough (server B-opt-1) — display only ──
    strategyVersion?: string;
    reserveUsd?: number;
    totalWealthUsd?: number;
    totalWealthReturnPct?: number;
    btcMom30?: number;
    msbWaiting?: boolean;
    msbWaitDays?: number;
    msbWaitLimit?: number;
    tfrScores?: Record<string, number>;
    btcTfr?: number;
    leaderAsset?: string;
    leaderScore?: number;
    leadOverBtc?: number;
    rotThreshold?: number;
    minHoldDays?: number;
    predictedAction?: string;
    predictedReason?: string;
    btcBreakoutLevel?: number;
    ethBreakoutLevel?: number;
    btcDistancePct?: number;
    fallbackInDays?: number;
    regimeLabel?: string;
    regimeTone?: "good" | "warn" | "danger" | "neutral";
    triggerConditions?: Array<{ label: string; probability: string }>;
    // authoritative rule decisions — { active, reason } per rule
    rulesStatus?: Record<string, { active?: boolean; reason?: string; [k: string]: unknown }>;
    btcHealth?: Record<string, number | string>;
    allAssetScores?: Record<string, { score?: number; tfr?: number; mom_30?: number; mom_14?: number; mom_7?: number; price?: number }>;
    entryStatus?: Record<string, number | string | boolean>;
    strategyParameters?: Record<string, number | string>;
    scriptPerformance?: Record<string, number | string>;
  };
  performance?: {
    btcHoldValueUsd?: number;
    outperformanceUsd?: number;
    outperformancePct?: number;
    unrealisedPnlUsd?: number;
    unrealisedPnlPct?: number;
    counters?: {
      rotations?: number;
      crashExits?: number;
      stopFires?: number;
      cashDays?: number;
      totalTrades?: number;
    };
  };
  preparation?: {
    readiness?: string;
    label?: string;
    note?: string;
    targetAsset?: string;
    topCandidates?: Array<{ asset?: string; symbol?: string; score?: number }>;
  };
  planning?: {
    currentBlocker?: string;
    candidateAsset?: string;
    holdDays?: number;
    nextActionSummary?: string;
    rule2Active?: boolean;
    earliestEligibleRunLabel?: string;
  };
  cashRisk?: {
    btcPrice?: number;
    btcDd30?: number;
    btcMom30?: number;
    btc30dHigh?: number;
    crashExitLevel?: number;
    stopLossLevel?: number;
    distanceToCrash?: number;
    crashActive?: boolean;
    stopActive?: boolean;
    statusLabel?: string;
    statusTone?: "good" | "warn" | "danger";
    regimeExitPrice?: number;
    distanceToRegimeExit?: number;
    // ── B-opt-1 passthrough: thresholds + script-emitted reasons/flags ──
    crashThreshold?: number;
    regimeExitThreshold?: number;
    regimeState?: string;
    crashReason?: string;
    stopReason?: string;
    msbReason?: string;
    regimeReason?: string;
    rotateReason?: string;
    msbActive?: boolean;
    regimeActive?: boolean;
  };
  ranking?: Array<{ asset: string; score: number; mom30: number; price: number; color: string; icon: string; galaxyScore?: number; altRank?: number; sentiment?: number; prevGalaxyScore?: number; prevAltRank?: number; prevSentiment?: number; trend?: string }>;
  tradeHistory?: Array<Record<string, unknown>>;
};

type TradeAlert = {
  asset: string;
  signal: string;
  price: number;
  atr: number | null;
  buyTrigger: number | null;
  buyTriggerPct: number | null;
  sellTrigger: number | null;
  sellTriggerPct: number | null;
  stopLossEst: number | null;
  stopPctEst: number | null;
  actualEntry: number | null;
  actualStop: number | null;
  actualStopPct: number | null;
  alertActive: boolean;
  color: string;
  icon: string;
};

type MsbSnapshot = {
  lastUpdate: string;
  signals: MsbAssetSignal[];
  tradeAlerts: TradeAlert[];
  available: boolean;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const [data, setData]         = useState<LivePortfolioSnapshot | null>(null);
  const [msb,  setMsb]          = useState<MsbSnapshot | null>(null);
  const [squeezeData, setSqueezeData] = useState<any | null>(null);
  const [loading, setLoading]   = useState(true);
  const { status: notifStatus, isSubscribed, subscribe, unsubscribe, reportSignalChange } = usePushNotifications();

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [portfolioRes, msbRes, squeezeRes] = await Promise.all([
          fetch("/api/live-portfolio",  { headers: { Accept: "application/json" } }),
          fetch("/api/msb-signals",     { headers: { Accept: "application/json" } }),
          fetch("/api/squeeze-data",    { headers: { Accept: "application/json" } }),
        ]);
        if (!portfolioRes.ok) throw new Error(`Portfolio HTTP ${portfolioRes.status}`);
        const portfolioJson = await portfolioRes.json();
        if (!cancelled) setData(portfolioJson);
        if (msbRes.ok) {
          const msbJson = await msbRes.json();
          if (!cancelled) setMsb(msbJson);
        }
        if (squeezeRes.ok) {
          const squeezeJson = await squeezeRes.json();
          if (!cancelled) setSqueezeData(squeezeJson);
        }
      } catch (error) {
        console.error("Failed to load portfolio data", error);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    const interval = setInterval(loadAll, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Fire notification when strategy signal or MSB signal changes
  useEffect(() => {
    if (!data?.summary) return;
    const action = data.summary.signalAction;
    const reason = (data.summary as any).ruleReason;
    if (action) reportSignalChange(action, null, reason);
  }, [data, reportSignalChange]);

  useEffect(() => {
    if (!msb?.signals?.length) return;
    const bullish = msb.signals.filter((s: any) => s.signal === "BULLISH_BREAK");
    const bearish = msb.signals.filter((s: any) => s.signal === "BEARISH_BREAK");
    if (bullish.length > 0) {
      const assets = bullish.map((s: any) => s.asset).join(", ");
      reportSignalChange(`MSB_BULLISH_${assets}`, null, `Bullish MSB breakout detected on ${assets}`);
    } else if (bearish.length > 0) {
      const assets = bearish.map((s: any) => s.asset).join(", ");
      reportSignalChange(`MSB_BEARISH_${assets}`, null, `Bearish MSB breakdown detected on ${assets}`);
    }
  }, [msb, reportSignalChange]);

  const summary     = data?.summary;
  const performance = data?.performance;
  const preparation = data?.preparation;
  const planning    = data?.planning;
  const cashRisk    = data?.cashRisk;
  const ranking     = data?.ranking ?? [];
  const history     = useMemo(() => (Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : []), [data]);
  const msbSignals    = msb?.signals ?? [];
  const tradeAlerts   = msb?.tradeAlerts ?? [];
  const squeezeCandidates = squeezeData?.candidates ?? [];
  const squeezeAvailable  = squeezeData?.available ?? false;
  const squeezeLastUpdated = squeezeData?.lastUpdated ?? null;
  const squeezeScanned    = squeezeData?.symbolsScanned ?? 0;
  const squeezeFound      = squeezeData?.candidatesFound ?? 0;

  const currentAsset = summary?.currentAsset ?? "CASH";
  const assetColor   = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;

  const portfolioVal      = summary?.displayedPortfolioValueUsd ?? 67428;
  const reserveUsd        = (summary as any)?.reserveUsd ?? 0;
  const totalWealthUsd    = (summary as any)?.totalWealthUsd ?? portfolioVal + reserveUsd;
  const totalWealthRetPct = (summary as any)?.totalWealthReturnPct ?? ((totalWealthUsd - 67428) / 67428 * 100);
  const fixedCap          = summary?.fixedCapitalUsd ?? 67428;
  // Use currentPositionValueUsd (positionUnits × live price) for P&L — NOT the stale state file value
  // currentPositionValueUsd is resolved below after performance is read, so we defer pnlUsd
  const pnlColor          = (v: number) => v >= 0 ? toneColor("good") : toneColor("danger");
  const regimeConf        = (summary as any)?.regimeConf ?? 0;
  const btcMom30          = (summary as any)?.btcMom30 ?? 0;
  const msbWaiting        = (summary as any)?.msbWaiting ?? false;
  const msbWaitDays       = (summary as any)?.msbWaitDays ?? 0;
  const msbWaitLimit      = (summary as any)?.msbWaitLimit ?? 5;
  const tfrScores         = ((summary as any)?.tfrScores ?? {}) as Record<string, number>;
  const btcTfr            = (summary as any)?.btcTfr ?? 0;
  // v4.1 new fields
  const predictedAction   = (summary as any)?.predictedAction ?? "";
  const predictedReason   = (summary as any)?.predictedReason ?? "";
  const triggerConditions = ((summary as any)?.triggerConditions ?? []) as Array<{label: string; probability: string}>;
  const leaderAsset       = (summary as any)?.leaderAsset ?? "";
  const leadOverBtc       = (summary as any)?.leadOverBtc ?? 0;
  const rotThreshold      = (summary as any)?.rotThreshold ?? 30;
  const minHoldDays       = (summary as any)?.minHoldDays ?? 7;
  const btcBreakoutLevel  = (summary as any)?.btcBreakoutLevel ?? 0;
  const ethBreakoutLevel  = (summary as any)?.ethBreakoutLevel ?? 0;
  const btcDistancePct    = (summary as any)?.btcDistancePct ?? 0;
  const fallbackInDays    = (summary as any)?.fallbackInDays ?? 0;
  const regimeLabel       = (summary as any)?.regimeLabel ?? (btcMom30 > 0 ? "BULLISH" : btcMom30 < -0.2 ? "BEARISH" : "NEUTRAL");
  const regimeTone        = (summary as any)?.regimeTone ?? (btcMom30 > 0 ? "good" : btcMom30 < -0.2 ? "danger" : "warn");
  // ── Authoritative emitted decision blocks (display only — the script decides, the UI shows) ──
  const rulesStatus        = summary?.rulesStatus ?? {};
  const strategyParameters = summary?.strategyParameters ?? {};
  const scriptPerformance  = summary?.scriptPerformance ?? {};
  const entryStatus        = summary?.entryStatus ?? {};
  // Rule active flags come ONLY from rulesStatus.rule_N (single source of truth);
  // distances/levels come from cashRisk. NOTE: sourcing one checklist row from two
  // objects (decision from rulesStatus, distance from cashRisk) is awkward — flagged
  // for a future server-side consolidation pass, NOT resolved via the cashRisk mirror.
  const rule = (n: string): { active: boolean; reason: string } => {
    const r = (rulesStatus as Record<string, { active?: boolean; reason?: string }>)?.[n] ?? {};
    return { active: r.active === true, reason: r.reason ?? "" };
  };

  const entryPrice              = summary?.entryPrice ?? 0;
  const currentPrice            = (performance as any)?.currentAssetPrice
    ?? ranking.find(r => r.asset === currentAsset)?.price ?? 0;
  const unrealisedPnlUsd        = (performance as any)?.unrealisedPnlUsd ?? 0;
  const unrealisedPct           = (performance as any)?.unrealisedPnlPct
    ?? (entryPrice > 0 && currentPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0);
  const currentPositionValueUsd = (performance as any)?.currentPositionValueUsd ?? portfolioVal;
  const positionUnits           = (performance as any)?.positionUnits ?? 0;
  const unrealisedColor         = unrealisedPct >= 0 ? toneColor("good") : toneColor("danger");

  // Active portfolio P&L: currentPositionValueUsd vs fixed capital $67,428
  const pnlUsd = currentPositionValueUsd - fixedCap;
  const pnlPct = fixedCap > 0 ? (pnlUsd / fixedCap) * 100 : 0;

  const prevTrade        = (performance as any)?.prevTrade ?? (performance as any)?.lastTrade ?? {};
  const lastTradeAction  = prevTrade.action ?? "";
  const lastTradeDate    = prevTrade.date ?? "";
  const lastTradePos     = prevTrade.position ?? "";
  const hasLastTrade     = !!lastTradeAction;

  const lastDailyClose = useMemo(() => {
    if (!Array.isArray(data?.tradeHistory) || data!.tradeHistory!.length === 0) return null;
    const btcPriceVal = Number((data!.tradeHistory![0] as any).btc_price ?? 0);
    return btcPriceVal > 0 ? btcPriceVal : null;
  }, [data]);
  const lastDailyCloseDate = useMemo(() => {
    if (!Array.isArray(data?.tradeHistory) || data!.tradeHistory!.length === 0) return null;
    return String((data!.tradeHistory![0] as any).date ?? "");
  }, [data]);

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border/30" style={{ background: "oklch(0.13 0.012 260 / 95%)", backdropFilter: "blur(12px)" }}>
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/">
              <div className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                <span className="text-xs">←</span>
                <span className="text-xs">Dashboard</span>
              </div>
            </Link>
            <div className="w-px h-5 bg-border/40" />
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.72 0.18 155 / 15%)", border: "1px solid oklch(0.72 0.18 155 / 25%)" }}>
                <TrendingUp size={16} style={{ color: "oklch(0.72 0.18 155)" }} />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>My Portfolio</h1>
                <p className="text-xs text-muted-foreground">BULL_ROTATE v4.1 · Fixed capital {loading ? "—" : formatUsd(fixedCap)}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {summary?.lastUpdate && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={11} />
                <span>{timeAgo(new Date(summary.lastUpdate))}</span>
              </div>
            )}
            {/* Notification bell */}
            {/* Bell always visible */ (
              <button
                onClick={isSubscribed ? unsubscribe : subscribe}
                title={isSubscribed ? "Notifications on — tap to disable" : notifStatus === "denied" ? "Notifications blocked — enable in browser settings" : notifStatus === "loading" ? "Enabling notifications..." : notifStatus === "error" ? "Tap to retry notifications" : "Enable signal notifications"}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                style={{
                  background: isSubscribed ? "oklch(0.72 0.18 155 / 15%)" : "oklch(0.55 0.010 260 / 20%)",
                  border: `1px solid ${isSubscribed ? "oklch(0.72 0.18 155 / 35%)" : "oklch(0.55 0.010 260 / 30%)"}`,
                  color: isSubscribed ? "oklch(0.72 0.18 155)" : "oklch(0.55 0.010 260)",
                  opacity: notifStatus === "denied" ? 0.4 : 1,
                  cursor: notifStatus === "denied" ? "not-allowed" : "pointer",
                }}
              >
                {isSubscribed ? <Bell size={14} /> : <BellOff size={14} />}
              </button>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold" style={{ background: `${assetColor}12`, borderColor: `${assetColor}30`, color: assetColor, fontFamily: "Syne, sans-serif" }}>
              <span>{ASSET_ICONS[currentAsset] ?? currentAsset}</span>
              <span>{currentAsset}</span>
            </div>
          </div>
        </div>
        <div className="container flex items-center gap-1 pb-0 pt-0 border-t border-border/20">
          <div className="px-4 py-2.5 text-xs font-semibold border-b-2 cursor-default" style={{ color: "oklch(0.72 0.18 155)", borderColor: "oklch(0.72 0.18 155)" }}>My Portfolio</div>
        </div>
      </header>

      <div className="container py-6 space-y-6">
        <BybitAccount />
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !data || !summary ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live portfolio snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please refresh the page. If the issue persists, verify that the live portfolio API is responding.</p>
          </div>
        ) : (
          <>
            {/* ── WHAT'S NEXT BANNER ── */}
            {(() => {
              const readinessStatus = preparation?.readiness ?? "HOLD";
              const isCashWaiting   = readinessStatus === "CASH_WAITING_MSB";
              const isCash          = currentAsset === "CASH";
              const isRotateReady   = readinessStatus === "ROTATE_READY";
              const isBuilding      = readinessStatus === "WATCH" || readinessStatus === "BUILD";
              const bannerColor     = isRotateReady
                ? "oklch(0.82 0.18 95)"
                : isCashWaiting
                ? "oklch(0.72 0.18 155)"
                : isCash
                ? "oklch(0.78 0.18 75)"
                : isBuilding
                ? "oklch(0.82 0.18 95)"
                : "oklch(0.72 0.18 155)";
              const bannerBg        = isRotateReady
                ? "oklch(0.82 0.18 95 / 8%)"
                : isCashWaiting
                ? "oklch(0.72 0.18 155 / 8%)"
                : "oklch(0.78 0.18 75 / 6%)";
              const bannerTitle     = isRotateReady
                ? `ROTATION SIGNAL — ${planning?.candidateAsset ?? preparation?.targetAsset ?? "ALT"}`
                : isCashWaiting
                ? `WAITING FOR BTC ENTRY — DAY ${msbWaitDays} OF ${msbWaitLimit}`
                : isCash && btcMom30 <= 0
                ? "HOLDING CASH — REGIME BEARISH"
                : isCash
                ? "WAITING TO RE-ENTER"
                : isBuilding
                ? `${planning?.candidateAsset ?? preparation?.targetAsset ?? "ALT"} BUILDING — WATCH`
                : `HOLDING ${currentAsset}`;
              return (
                <div className="rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  style={{ background: bannerBg, border: `1px solid ${bannerColor}30` }}>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: bannerColor }} />
                    <div>
                      <p className="text-xs font-bold tracking-widest uppercase" style={{ color: bannerColor }}>{bannerTitle}</p>
                      <p className="text-sm text-foreground/80 mt-0.5">
                {(() => {
                  const note = preparation?.note ?? planning?.nextActionSummary ?? "";
                  // If TFR scores aren't populated yet (all zero), show a cleaner message
                  if (note.includes("TFR 0.000") || note.includes("TFR score (0.000)")) {
                    if (currentAsset === "CASH" && msbWaiting) return `Waiting for BTC to break above its pivot high — fallback entry in ${Math.max(0, msbWaitLimit - msbWaitDays)} day${Math.max(0, msbWaitLimit - msbWaitDays) === 1 ? "" : "s"} if no MSB fires.`;
                    if (currentAsset === "CASH") return "Regime is bullish — waiting for BTC market structure break to re-enter.";
                    return "Holding position — TFR scores update each daily close at 00:05 UTC.";
                  }
                  return note || "Monitoring daily closes.";
                })()}
              </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {isCashWaiting && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Fallback entry in</p>
                        <p className="text-lg font-bold mono-data" style={{ color: bannerColor }}>{Math.max(0, msbWaitLimit - msbWaitDays)} day{Math.max(0, msbWaitLimit - msbWaitDays) === 1 ? "" : "s"}</p>
                      </div>
                    )}
                    {isRotateReady && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">TFR Lead</p>
                        <p className="text-lg font-bold mono-data" style={{ color: bannerColor }}>
                          +{(tfrScores[planning?.candidateAsset ?? preparation?.targetAsset ?? ""] ?? 0) > 0
                            ? ((tfrScores[planning?.candidateAsset ?? preparation?.targetAsset ?? ""] ?? 0) - btcTfr).toFixed(3)
                            : "—"}
                        </p>
                      </div>
                    )}
                    {!isCashWaiting && !isRotateReady && currentAsset !== "CASH" && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">BTC 30d Momentum</p>
                        <p className="text-lg font-bold mono-data" style={{ color: btcMom30 >= 0 ? toneColor("good") : toneColor("danger") }}>
                          {btcMom30 >= 0 ? "+" : ""}{btcMom30.toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* ── Top stat cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Active Portfolio"
                value={formatLargeNumber(currentPositionValueUsd)}
                sub={
                  currentAsset === "CASH"
                    ? `Cash — exited at ${formatUsd(currentPositionValueUsd)}`
                    : `${pnlUsd >= 0 ? "+" : ""}${formatLargeNumber(pnlUsd)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) vs $67,428 start`
                }
                color={pnlColor(pnlUsd)}
                icon={<DollarSign size={14} />}
              />
              <StatCard label="Reserve (Cashed Out)" value={formatLargeNumber(reserveUsd)} sub={reserveUsd > 0 ? "Profit locked in — ready to redeploy" : "No profits cashed out yet"} color="oklch(0.82 0.18 95)" icon={<ArrowUpRight size={14} />} />
              <StatCard label="Total Wealth" value={formatLargeNumber(totalWealthUsd)} sub={`${totalWealthRetPct >= 0 ? "+" : ""}${totalWealthRetPct.toFixed(2)}% vs $67,428 start`} color="oklch(0.72 0.18 155)" icon={<TrendingUp size={14} />} />
              <StatCard
                label="Unrealised P&L"
                value={
                  currentAsset === "CASH"
                    ? "In Cash"
                    : `${unrealisedPnlUsd >= 0 ? "+" : "-"}${formatUsd(Math.abs(unrealisedPnlUsd))}`
                }
                sub={
                  currentAsset === "CASH"
                    ? "No active position — awaiting re-entry signal"
                    : `${unrealisedPct >= 0 ? "+" : ""}${unrealisedPct.toFixed(2)}% · Entry ${formatUsd(entryPrice)} · ${positionUnits > 0 ? positionUnits.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"} ${currentAsset}`
                }
                color={currentAsset === "CASH" ? toneColor("neutral") : unrealisedColor}
                icon={<BarChart2 size={14} />}
              />
              <StatCard label="Last Daily Close" value={lastDailyClose != null ? formatUsd(lastDailyClose) : "—"} sub={lastDailyCloseDate ? `Recorded ${lastDailyCloseDate} at script run` : "Awaiting first run"} color="oklch(0.60 0.22 255)" icon={<Clock size={14} />} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Current Position" value={currentAsset} sub={summary.entryDate ? `Entered ${summary.entryDate} · ${summary.holdDays ?? 0}d held` : "Awaiting position"} color={assetColor} icon={<Activity size={14} />} />
              <StatCard
                label="Last Trade Signal"
                value={hasLastTrade ? lastTradeAction.replace(/_/g, " ") : "None yet"}
                sub={hasLastTrade ? `${lastTradeDate} · was in ${lastTradePos}` : "No completed trades"}
                color={hasLastTrade ? toneColor("neutral") : toneColor("warn")}
                icon={<ArrowUpRight size={14} />}
              />
              <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: `${toneColor(regimeTone as any)}25` }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-muted-foreground">BTC Regime</p>
                </div>
                <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: toneColor(regimeTone as any) }}>{regimeLabel}</p>
                <p className="text-xs text-muted-foreground/60 mono-data">
                  {btcMom30 !== 0
                    ? `${btcMom30 >= 0 ? "+" : ""}${btcMom30.toFixed(1)}% 30d momentum`
                    : regimeConf > 0 ? `${regimeConf.toFixed(1)}% range confidence` : "Awaiting data"}
                </p>
              </div>
              <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: (preparation?.readiness === "ROTATE_READY") ? "oklch(0.82 0.18 95 / 25%)" : "oklch(0.72 0.18 155 / 25%)" }}>
                <p className="text-xs text-muted-foreground">Rotation Status</p>
                <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: (preparation?.readiness === "ROTATE_READY") ? toneColor("warn") : (preparation?.readiness === "WATCH") ? "oklch(0.82 0.18 95)" : toneColor("good") }}>
                  {(preparation?.readiness === "ROTATE_READY") ? "SIGNAL" : (preparation?.readiness === "WATCH") ? "BUILDING" : "HOLDING"}
                </p>
                <p className="text-xs text-muted-foreground/60 mono-data">
                  {(preparation?.readiness === "ROTATE_READY")
                    ? `Rotate to ${planning?.candidateAsset ?? preparation?.targetAsset ?? "alt"}`
                    : (preparation?.readiness === "WATCH")
                    ? `${planning?.candidateAsset ?? preparation?.targetAsset ?? "Alt"} building lead`
                    : "BTC is strongest asset"}
                </p>
              </div>
            </div>

            {/* ── Position detail + rotation readiness ── */}
            <div className="panel p-5" style={{ borderColor: `${assetColor}25`, background: `${assetColor}06` }}>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-1">Current Position State</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: assetColor }}>{ASSET_ICONS[currentAsset] ?? currentAsset}</span>
                    <h2 className="text-xl font-bold" style={{ fontFamily: "Syne, sans-serif", color: assetColor }}>{currentAsset}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-2xl">
                    {predictedReason || preparation?.note || summary.ruleReason || "—"}
                  </p>
                  {/* Stop loss + crash exit badges — only when in a position */}
                  {currentAsset !== "CASH" && cashRisk?.stopLossLevel != null && cashRisk.stopLossLevel > 0 && (
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "oklch(0.62 0.22 25 / 12%)", border: "1px solid oklch(0.62 0.22 25 / 35%)" }}>
                        <Shield size={12} style={{ color: "oklch(0.62 0.22 25)" }} />
                        <span className="text-xs text-muted-foreground">Stop Loss</span>
                        <span className="text-sm font-bold mono-data" style={{ color: "oklch(0.62 0.22 25)" }}>{formatUsd(cashRisk.stopLossLevel)}</span>
                        <span className="text-xs text-muted-foreground/60">−15% from entry</span>
                      </div>
                      {(cashRisk.crashExitLevel ?? 0) > 0 && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "oklch(0.72 0.18 155 / 8%)", border: "1px solid oklch(0.72 0.18 155 / 25%)" }}>
                          <Shield size={12} style={{ color: "oklch(0.72 0.18 155)" }} />
                          <span className="text-xs text-muted-foreground">Crash Exit</span>
                          <span className="text-sm font-bold mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>{formatUsd(cashRisk.crashExitLevel)}</span>
                          <span className="text-xs text-muted-foreground/60">−25% BTC 30d DD</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="panel px-4 py-3 min-w-[220px]" style={{ background: "oklch(0.10 0.010 260 / 55%)"}}>
                  <p className="text-xs text-muted-foreground mb-1">Last signal</p>
                  <p className="text-lg font-bold" style={{ fontFamily: "Syne, sans-serif", color: assetColor }}>{summary.signalAction ?? "HOLD"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{summary.ruleReason ?? "—"}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                {/* TFR Score Ranking + LunarCrush */}
                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={14} style={{ color: assetColor, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Asset Leaderboard</h2>
                  </div>
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_auto] gap-x-2 mb-1 px-3">
                    <span className="text-xs text-muted-foreground/40 uppercase tracking-widest">Asset</span>
                    <div className="flex gap-4 text-right">
                      <span className="text-xs text-muted-foreground/40 uppercase tracking-widest w-12">TFR</span>
                      <span className="text-xs text-muted-foreground/40 uppercase tracking-widest w-14">Galaxy</span>
                      <span className="text-xs text-muted-foreground/40 uppercase tracking-widest w-14">AltRank</span>
                      <span className="text-xs text-muted-foreground/40 uppercase tracking-widest w-14">Sentiment</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {ranking.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No ranking data available.</p>
                    ) : ranking.map((row, i) => {
                      const rowTfr = tfrScores[row.asset] ?? (row as any).tfrScore ?? 0;
                      const btcTfrVal = tfrScores["BTC"] ?? btcTfr;
                      const lead = rowTfr - btcTfrVal;
                      // Decision from the emitted rule block — NOT a TS threshold compare.
                      // SIGNAL = the script's rotation rule is active for the emitted leader.
                      const isRotationCandidate = row.asset === leaderAsset && row.asset !== "BTC" && rule("rule_5_rotate").active;
                      // LEADER = descriptive label for the emitted best-alt; not a decision.
                      const isBuilding = row.asset === leaderAsset && row.asset !== "BTC" && !isRotationCandidate;

                      const gs = row.galaxyScore ?? 0;
                      const gsPrev = row.prevGalaxyScore ?? 0;
                      const gsDelta = gs > 0 && gsPrev > 0 ? gs - gsPrev : null;
                      const gsColor = gs >= 65 ? "oklch(0.72 0.20 150)" : gs >= 50 ? "oklch(0.82 0.18 75)" : "oklch(0.65 0.15 30)";

                      const ar = row.altRank ?? 0;
                      const arPrev = row.prevAltRank ?? 0;
                      const arDelta = ar > 0 && arPrev > 0 ? ar - arPrev : null; // lower is better
                      const arColor = ar > 0 && ar <= 50 ? "oklch(0.72 0.20 150)" : ar <= 200 ? "oklch(0.82 0.18 75)" : "oklch(0.65 0.15 30)";

                      const sent = row.sentiment ?? 0;
                      const sentPrev = row.prevSentiment ?? 0;
                      const sentDelta = sent > 0 && sentPrev > 0 ? sent - sentPrev : null;
                      const sentColor = sent >= 80 ? "oklch(0.72 0.20 150)" : sent >= 65 ? "oklch(0.82 0.18 75)" : "oklch(0.65 0.15 30)";

                      return (
                        <div key={row.asset} className="rounded-lg border px-3 py-2.5"
                          style={{
                            background: isRotationCandidate ? `${row.color}10` : "oklch(1 0 0 / 3%)",
                            borderColor: isRotationCandidate ? `${row.color}40` : isBuilding ? `${row.color}25` : "oklch(1 0 0 / 8%)",
                          }}>
                          {/* Row top: asset name + badges + TFR */}
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground/50 w-4">{i + 1}</span>
                              <span style={{ color: row.color }}>{row.icon}</span>
                              <span className="font-semibold text-foreground/85">{row.asset}</span>
                              {isRotationCandidate && <span className="text-xs px-1.5 py-0.5 rounded font-bold" style={{ background: `${row.color}20`, color: row.color }}>SIGNAL</span>}
                              {isBuilding && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "oklch(0.82 0.18 95 / 15%)", color: "oklch(0.82 0.18 95)" }}>LEADER</span>}
                            </div>
                            <div className="text-right">
                              <span className="mono-data font-bold text-sm" style={{ color: row.color }}>{rowTfr > 0 ? rowTfr.toFixed(2) : row.score.toFixed(1)}</span>
                              <p className="text-xs text-muted-foreground">
                                {row.asset !== "BTC" && rowTfr > 0
                                  ? (lead >= 0 ? `+${lead.toFixed(2)} vs BTC` : `${lead.toFixed(2)} vs BTC`)
                                  : `${row.mom30 >= 0 ? "+" : ""}${row.mom30.toFixed(1)}% 30d`}
                              </p>
                            </div>
                          </div>
                          {/* LunarCrush metrics row */}
                          <div className="flex gap-3 mt-1 pt-1.5 border-t" style={{ borderColor: "oklch(1 0 0 / 6%)" }}>
                            {/* Galaxy Score */}
                            <div className="flex-1 text-center">
                              <p className="text-xs text-muted-foreground/40 mb-0.5">Galaxy</p>
                              <div className="flex items-center justify-center gap-1">
                                <span className="mono-data text-sm font-bold" style={{ color: gs > 0 ? gsColor : "oklch(0.5 0 0)" }}>
                                  {gs > 0 ? gs.toFixed(1) : "—"}
                                </span>
                                {gsDelta !== null && (
                                  <span className="text-xs" style={{ color: gsDelta >= 0 ? "oklch(0.72 0.20 150)" : "oklch(0.65 0.15 30)" }}>
                                    {gsDelta >= 0 ? "▲" : "▼"}{Math.abs(gsDelta).toFixed(1)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* AltRank */}
                            <div className="flex-1 text-center">
                              <p className="text-xs text-muted-foreground/40 mb-0.5">AltRank</p>
                              <div className="flex items-center justify-center gap-1">
                                <span className="mono-data text-sm font-bold" style={{ color: ar > 0 ? arColor : "oklch(0.5 0 0)" }}>
                                  {ar > 0 ? `#${ar}` : "—"}
                                </span>
                                {arDelta !== null && (
                                  <span className="text-xs" style={{ color: arDelta <= 0 ? "oklch(0.72 0.20 150)" : "oklch(0.65 0.15 30)" }}>
                                    {arDelta <= 0 ? "▲" : "▼"}{Math.abs(arDelta)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Sentiment */}
                            <div className="flex-1 text-center">
                              <p className="text-xs text-muted-foreground/40 mb-0.5">Sentiment</p>
                              <div className="flex items-center justify-center gap-1">
                                <span className="mono-data text-sm font-bold" style={{ color: sent > 0 ? sentColor : "oklch(0.5 0 0)" }}>
                                  {sent > 0 ? `${sent}%` : "—"}
                                </span>
                                {sentDelta !== null && (
                                  <span className="text-xs" style={{ color: sentDelta >= 0 ? "oklch(0.72 0.20 150)" : "oklch(0.65 0.15 30)" }}>
                                    {sentDelta >= 0 ? "▲" : "▼"}{Math.abs(sentDelta)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {Object.values(tfrScores).every(v => v === 0) && (
                    <p className="text-xs text-amber-400/60 mt-2">TFR scores update after the next script run (00:05 UTC). Showing composite momentum scores in the meantime.</p>
                  )}
                  <p className="text-xs text-muted-foreground/50 mt-2">Galaxy Score 0–100 (≥65 = strong). AltRank: lower = better (≤50 = top tier). Sentiment: % positive posts. ▲▼ = vs yesterday.</p>
                </div>

                {/* ── Panel B: What Happens Next ── */}
                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap size={14} style={{ color: "oklch(0.78 0.18 75)", opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>What Happens Next</h2>
                  </div>
                  {/* Predicted action badge — populated by optimized_strategy_data.json */}
                  {predictedAction && (
                    <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg" style={{ background: "oklch(0.78 0.18 75 / 10%)", border: "1px solid oklch(0.78 0.18 75 / 25%)" }}>
                      <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: "oklch(0.78 0.18 75 / 20%)", color: "oklch(0.78 0.18 75)" }}>{predictedAction}</span>
                      <span className="text-xs text-muted-foreground">{predictedReason}</span>
                    </div>
                  )}
                  {/* Trigger conditions from optimized_strategy_data.json */}
                  {triggerConditions.length > 0 ? (
                    <div className="space-y-2">
                      {triggerConditions.map((cond, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "oklch(1 0 0 / 3%)", border: "1px solid oklch(1 0 0 / 8%)" }}>
                          <span className="text-xs text-foreground/80">{cond.label}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{
                            background: cond.probability === "certain" ? "oklch(0.72 0.18 155 / 15%)" : cond.probability === "high" ? "oklch(0.78 0.18 75 / 15%)" : "oklch(0.60 0.22 255 / 15%)",
                            color: cond.probability === "certain" ? "oklch(0.72 0.18 155)" : cond.probability === "high" ? "oklch(0.78 0.18 75)" : "oklch(0.60 0.22 255)",
                          }}>{cond.probability}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {/* Fallback: derive from state fields until optimized_strategy_data.json is written */}
                      {currentAsset === "CASH" && (
                        <>
                          <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                            <span className="text-muted-foreground">Regime</span>
                            <span className="font-semibold" style={{ color: btcMom30 > 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }}>{btcMom30 > 0 ? `BULLISH +${btcMom30.toFixed(1)}%` : `BEARISH ${btcMom30.toFixed(1)}%`}</span>
                          </div>
                          {btcMom30 > 0 && (
                            <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                              <span className="text-muted-foreground">MSB wait day</span>
                              <span className="font-semibold mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>Day {msbWaitDays > 0 ? msbWaitDays : 1} of {msbWaitLimit}</span>
                            </div>
                          )}
                          {btcMom30 > 0 && (
                            <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                              <span className="text-muted-foreground">Fallback entry in</span>
                              <span className="font-semibold mono-data" style={{ color: fallbackInDays === 0 ? "oklch(0.72 0.18 155)" : "oklch(0.60 0.22 255)" }}>{fallbackInDays > 0 ? fallbackInDays : Math.max(0, msbWaitLimit - (msbWaitDays > 0 ? msbWaitDays : 1))} day{(fallbackInDays > 0 ? fallbackInDays : Math.max(0, msbWaitLimit - (msbWaitDays > 0 ? msbWaitDays : 1))) === 1 ? "" : "s"}</span>
                            </div>
                          )}
                          {btcBreakoutLevel > 0 && (
                            <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                              <span className="text-muted-foreground">BTC MSB breakout at</span>
                              <span className="font-semibold mono-data" style={{ color: "oklch(0.78 0.18 75)" }}>{formatUsd(btcBreakoutLevel)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {currentAsset !== "CASH" && (
                        <>
                          <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                            <span className="text-muted-foreground">Min hold</span>
                            <span className="font-semibold mono-data" style={{ color: (summary?.holdDays ?? 0) >= minHoldDays ? "oklch(0.72 0.18 155)" : "oklch(0.78 0.18 75)" }}>Day {summary?.holdDays ?? 0} of {minHoldDays}</span>
                          </div>
                          {leaderAsset && leaderAsset !== currentAsset && (
                            <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                              <span className="text-muted-foreground">Rotation candidate</span>
                              <span className="font-semibold" style={{ color: ASSET_COLORS[leaderAsset] ?? "white" }}>{leaderAsset} {leadOverBtc > 0 ? `(+${leadOverBtc.toFixed(2)} pts)` : ""}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                            <span className="text-muted-foreground">Rotation fires at</span>
                            <span className="font-semibold mono-data text-foreground/80">+{rotThreshold} TFR pt lead</span>
                          </div>
                          <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                            <span className="text-muted-foreground">Regime exit</span>
                            {/* active flag from rulesStatus.rule_4_regime (decision); distance from cashRisk (display) */}
                            <span className="font-semibold mono-data" style={{ color: rule("rule_4_regime").active ? "oklch(0.62 0.22 25)" : "oklch(0.78 0.18 75)" }}>
                              {cashRisk?.distanceToRegimeExit != null
                                ? `${cashRisk.distanceToRegimeExit.toFixed(1)}pp to ${cashRisk.regimeExitThreshold ?? -5}% 30d mom`
                                : "BTC 30d mom vs −5%"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-1.5">
                            <span className="text-muted-foreground">Stop loss</span>
                            <span className="font-semibold mono-data" style={{ color: rule("rule_2_stop").active ? "oklch(0.62 0.22 25)" : "oklch(0.78 0.18 75)" }}>{cashRisk?.stopReason || "−15% from entry"}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {/* BTC 30d momentum gauge */}
                  <div className="mt-4 pt-3 border-t border-border/20">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">BTC 30d Momentum</span>
                      <span className="font-bold mono-data" style={{ color: btcMom30 > 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }}>{btcMom30 > 0 ? "+" : ""}{btcMom30.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${Math.min(100, Math.max(0, 50 + btcMom30 * 1.5))}%`,
                        background: btcMom30 > 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)",
                      }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground/40 mt-1">
                      <span>−33%</span><span>0%</span><span>+33%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* ══════════════════════════════════════════════════════════════════
                SHORT SQUEEZE SCANNER
            ══════════════════════════════════════════════════════════════════ */}
            <div className="panel p-5" style={{ borderColor: "oklch(0.72 0.22 25 / 30%)" }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Zap size={16} style={{ color: "oklch(0.72 0.22 25)" }} />
                  <div>
                    <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>Short Squeeze Scanner</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Top 3 squeeze candidates · {squeezeScanned > 0 ? `${squeezeScanned} Binance futures scanned` : "Scanning all Binance futures"} · Updated every 8 hours
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {squeezeLastUpdated && (
                    <span className="text-xs text-muted-foreground hidden sm:block">{timeAgo(new Date(squeezeLastUpdated))}</span>
                  )}
                  <div className="flex items-center gap-2 px-2 py-1 rounded text-xs" style={{ background: "oklch(0.72 0.22 25 / 10%)", border: "1px solid oklch(0.72 0.22 25 / 25%)", color: "oklch(0.72 0.22 25)" }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "oklch(0.72 0.22 25)" }} />
                    LIVE
                  </div>
                </div>
              </div>

              {/* How it works */}
              <div className="rounded-lg p-3 mb-5 text-xs text-muted-foreground" style={{ background: "oklch(0.72 0.22 25 / 6%)", border: "1px solid oklch(0.72 0.22 25 / 15%)" }}>
                <span className="text-foreground font-semibold">How it works: </span>
                Each coin is scored 0–100 across four signals: <span className="text-foreground">Funding Rate Negativity</span> (shorts paying longs = crowded short),{" "}
                <span className="text-foreground">OI Build vs Price Flat</span> (coiled spring), <span className="text-foreground">Smart Money Long Bias</span> (top traders long while retail shorts),{" "}
                and <span className="text-foreground">Price Structure</span> (above EMA20 + tight compression). Minimum score of 45/100 required to appear.
              </div>

              {!squeezeAvailable ? (
                <div className="text-sm text-muted-foreground p-6 text-center rounded-lg" style={{ background: "oklch(0.72 0.22 25 / 5%)", border: "1px dashed oklch(0.72 0.22 25 / 20%)" }}>
                  <Zap size={20} className="mx-auto mb-2 opacity-40" style={{ color: "oklch(0.72 0.22 25)" }} />
                  <p className="font-medium text-foreground mb-1">Scanner not yet initialised</p>
                  <p className="text-xs">Run <code className="bg-white/10 px-1 rounded">python3 /root/crypto_dashboard/scripts/squeeze_scanner.py</code> on the droplet to generate the first scan.</p>
                </div>
              ) : squeezeCandidates.length === 0 ? (
                <div className="text-sm text-muted-foreground p-6 text-center rounded-lg" style={{ background: "oklch(0.72 0.22 25 / 5%)", border: "1px dashed oklch(0.72 0.22 25 / 20%)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "oklch(0.72 0.18 155 / 15%)" }}>
                    <TrendingUp size={16} style={{ color: "oklch(0.72 0.18 155)" }} />
                  </div>
                  <p className="font-semibold text-foreground mb-1">No Squeeze Candidates Detected</p>
                  <p className="text-xs">
                    {squeezeScanned > 0 ? `${squeezeScanned} coins scanned` : "All Binance futures scanned"} — no coins met the 45/100 confidence threshold.
                    Market conditions do not currently favour a short squeeze setup.
                  </p>
                  {squeezeLastUpdated && (
                    <p className="text-xs mt-2 opacity-60">Last scanned: {new Date(squeezeLastUpdated).toLocaleString()}</p>
                  )}
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-4">
                  {squeezeCandidates.map((c: any, i: number) => {
                    const rankColors = ["oklch(0.82 0.18 95)", "oklch(0.72 0.18 155)", "oklch(0.60 0.22 255)"];
                    const rankLabels = ["#1 CANDIDATE", "#2 CANDIDATE", "#3 CANDIDATE"];
                    const rankColor = rankColors[i] ?? "oklch(0.60 0.22 255)";
                    const confColor = c.confidence >= 70 ? "oklch(0.72 0.22 25)" : c.confidence >= 55 ? "oklch(0.82 0.18 95)" : "oklch(0.60 0.22 255)";
                    const confLabel = c.confidence >= 70 ? "HIGH" : c.confidence >= 55 ? "MEDIUM" : "WATCH";
                    return (
                      <div key={c.symbol} className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "oklch(0.14 0.02 255 / 60%)", border: `1px solid ${rankColor}30` }}>
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: `${rankColor}20`, color: rankColor }}>
                                {rankLabels[i]}
                              </span>
                            </div>
                            <p className="text-xl font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>{c.base}</p>
                            <p className="text-xs text-muted-foreground">${c.price < 0.01 ? c.price.toFixed(6) : c.price < 1 ? c.price.toFixed(4) : c.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          </div>
                          {/* Confidence gauge */}
                          <div className="flex flex-col items-center">
                            <div className="relative w-14 h-14">
                              <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
                                <circle cx="28" cy="28" r="22" fill="none" stroke="oklch(0.25 0.02 255)" strokeWidth="5" />
                                <circle cx="28" cy="28" r="22" fill="none" stroke={confColor} strokeWidth="5"
                                  strokeDasharray={`${(c.confidence / 100) * 138.2} 138.2`} strokeLinecap="round" />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-xs font-bold text-white">{Math.round(c.confidence)}</span>
                              </div>
                            </div>
                            <span className="text-xs font-bold mt-0.5" style={{ color: confColor }}>{confLabel}</span>
                          </div>
                        </div>

                        {/* Score breakdown */}
                        <div className="space-y-1.5">
                          {[
                            { label: "Funding Negativity", val: c.components.fundingNegativity, max: 35, detail: c.raw.fundingNegStreak > 0 ? `${c.raw.fundingNegStreak} neg periods · ${c.raw.fundingLast >= 0 ? "+" : ""}${c.raw.fundingLast.toFixed(4)}%` : `${c.raw.fundingLast >= 0 ? "+" : ""}${c.raw.fundingLast.toFixed(4)}% last` },
                            { label: "OI Build vs Price", val: c.components.oiBuild, max: 25, detail: `OI ${c.raw.oiChange5dPct >= 0 ? "+" : ""}${c.raw.oiChange5dPct.toFixed(1)}% in 5d` },
                            { label: "Smart Money Long", val: c.components.smartMoneyLong, max: 20, detail: c.raw.lsLongsPct != null ? `${c.raw.lsLongsPct.toFixed(1)}% longs · L/S ${c.raw.lsRatio?.toFixed(2)}` : "No L/S data" },
                            { label: "Price Structure", val: c.components.priceStructure, max: 20, detail: c.raw.priceVsEma20 != null ? `${c.raw.priceVsEma20 >= 0 ? "+" : ""}${c.raw.priceVsEma20.toFixed(1)}% vs EMA20 · ATR ${c.raw.atrPct?.toFixed(1)}%` : "Structure data" },
                          ].map(row => (
                            <div key={row.label}>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-muted-foreground">{row.label}</span>
                                <span className="text-foreground font-mono">{row.val.toFixed(0)}/{row.max}</span>
                              </div>
                              <div className="w-full h-1.5 rounded-full" style={{ background: "oklch(0.25 0.02 255)" }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${(row.val / row.max) * 100}%`, background: row.val / row.max > 0.6 ? "oklch(0.72 0.22 25)" : row.val / row.max > 0.35 ? "oklch(0.82 0.18 95)" : "oklch(0.60 0.22 255)" }} />
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 opacity-70">{row.detail}</p>
                            </div>
                          ))}
                        </div>

                        {/* Total score bar */}
                        <div className="pt-2 border-t" style={{ borderColor: `${rankColor}20` }}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-semibold text-foreground">Total Score</span>
                            <span className="font-bold font-mono" style={{ color: confColor }}>{c.confidence.toFixed(1)} / 100</span>
                          </div>
                          <div className="w-full h-2 rounded-full" style={{ background: "oklch(0.25 0.02 255)" }}>
                            <div className="h-full rounded-full" style={{ width: `${c.confidence}%`, background: `linear-gradient(90deg, oklch(0.60 0.22 255), ${confColor})` }} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Min threshold: 45/100 · {squeezeFound} coin{squeezeFound !== 1 ? "s" : ""} passed
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* ── Performance stats ── */}
            {/* ── Performance stats ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Return (Active)" value={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`} sub={`${pnlUsd >= 0 ? "+" : ""}${formatUsd(pnlUsd)} active portfolio`} color={pnlColor(pnlUsd)} icon={<TrendingUp size={14} />} />
              <StatCard label="Total Return (Wealth)" value={`${totalWealthRetPct >= 0 ? "+" : ""}${totalWealthRetPct.toFixed(2)}%`} sub={`Portfolio + reserve vs ${formatUsd(fixedCap)} start`} color="oklch(0.72 0.18 155)" icon={<TrendingUp size={14} />} />
              <StatCard label="Total Trades" value={String(performance?.counters?.totalTrades ?? 0)} sub={`${performance?.counters?.rotations ?? 0} rotations · ${performance?.counters?.stopFires ?? 0} stops · ${performance?.counters?.crashExits ?? 0} crashes`} color="oklch(0.60 0.22 255)" icon={<Zap size={14} />} />
              <StatCard label="Cash-Out Events" value={String((performance?.counters as any)?.cashoutFires ?? 0)} sub={`${formatLargeNumber((performance?.counters as any)?.totalCashedOut ?? 0)} total cashed out to reserve`} color="oklch(0.82 0.18 95)" icon={<DollarSign size={14} />} />
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                ② EXIT TELEMETRY CHECKLIST (IN-POSITION) / ③ ENTRY GATE (CASH)
                Active/triggered state comes ONLY from summary.rulesStatus.rule_N.active
                (the authoritative decision). Distances/thresholds come from cashRisk.
                The dashboard DISPLAYS the script's decisions; it never re-decides.
            ══════════════════════════════════════════════════════════════════ */}
            {cashRisk && currentAsset !== "CASH" && (
              <div className="panel p-5" style={{ borderColor: "oklch(0.62 0.22 25 / 22%)" }}>
                <SectionTitle icon={<Shield size={14} className="text-primary opacity-70" />}>Exit Telemetry — Prioritised Checklist</SectionTitle>
                <div className="space-y-2">
                  {([
                    { n: 1, name: "Crash exit", r: rule("rule_1_crash"),
                      dist: cashRisk.distanceToCrash != null ? `${cashRisk.distanceToCrash.toFixed(1)}pp to ${((cashRisk.crashThreshold ?? -0.25) * 100).toFixed(0)}% BTC 30d DD` : "BTC 30d drawdown vs −25%" },
                    { n: 2, name: "Stop loss", r: rule("rule_2_stop"),
                      dist: "−15% from entry price" },
                    { n: 3, name: "MSB structural exit", r: rule("rule_3_msb"),
                      dist: (summary?.holdDays ?? 0) >= minHoldDays ? "pivot-low break (active)" : `gated until day ${minHoldDays} (min hold)` },
                    { n: 4, name: "Regime exit", r: rule("rule_4_regime"),
                      dist: cashRisk.distanceToRegimeExit != null ? `${cashRisk.distanceToRegimeExit.toFixed(1)}pp to ${cashRisk.regimeExitThreshold ?? -5}% BTC 30d mom` : "BTC 30d mom vs −5%" },
                  ]).map(row => (
                    <div key={row.n} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 border"
                      style={{
                        background: row.r.active ? "oklch(0.62 0.22 25 / 8%)" : "oklch(1 0 0 / 3%)",
                        borderColor: row.r.active ? "oklch(0.62 0.22 25 / 40%)" : "oklch(1 0 0 / 8%)",
                      }}>
                      <div className="flex items-start gap-2.5">
                        <span className="text-xs mono-data text-muted-foreground/50 mt-0.5">{row.n}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground/85">{row.name}</span>
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                              style={{ background: row.r.active ? "oklch(0.62 0.22 25 / 20%)" : "oklch(0.72 0.18 155 / 15%)", color: row.r.active ? "oklch(0.62 0.22 25)" : "oklch(0.72 0.18 155)" }}>
                              {row.r.active ? "TRIGGERED" : "CLEAR"}
                            </span>
                          </div>
                          {row.r.reason && <p className="text-xs text-muted-foreground/70 mt-0.5">{row.r.reason}</p>}
                        </div>
                      </div>
                      <span className="text-xs mono-data text-muted-foreground text-right whitespace-nowrap mt-0.5">{row.dist}</span>
                    </div>
                  ))}
                </div>
                {/* Min-hold countdown — display only (days held vs MIN_HOLD_DAYS) */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20 text-sm">
                  <span className="text-muted-foreground">Min-hold countdown</span>
                  <span className="font-semibold mono-data" style={{ color: (summary?.holdDays ?? 0) >= minHoldDays ? "oklch(0.72 0.18 155)" : "oklch(0.78 0.18 75)" }}>
                    Day {summary?.holdDays ?? 0} of {minHoldDays}{(summary?.holdDays ?? 0) >= minHoldDays ? " — rotation rules eligible" : ""}
                  </span>
                </div>
              </div>
            )}

            {cashRisk && currentAsset === "CASH" && (
              <div className="panel p-5" style={{ borderColor: "oklch(0.78 0.18 75 / 22%)" }}>
                <SectionTitle icon={<Shield size={14} className="text-primary opacity-70" />}>Entry Gate — Re-entry Conditions</SectionTitle>
                <div className="space-y-2 text-sm">
                  {/* Regime gate — emitted regime classification + 30d momentum (display only) */}
                  <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                    <span className="text-muted-foreground">Regime gate (BTC 30d mom)</span>
                    <span className="font-semibold mono-data" style={{ color: btcMom30 > 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }}>
                      {regimeLabel} · {btcMom30 >= 0 ? "+" : ""}{btcMom30.toFixed(1)}%
                    </span>
                  </div>
                  {/* MSB gate — entryStatus phase + wait day vs limit */}
                  <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                    <span className="text-muted-foreground">MSB gate (wait day)</span>
                    <span className="font-semibold mono-data text-foreground/80">
                      Day {(entryStatus as any)?.msb_wait_day ?? msbWaitDays} of {msbWaitLimit}{(entryStatus as any)?.phase ? ` · ${(entryStatus as any).phase}` : ""}
                    </span>
                  </div>
                  {((entryStatus as any)?.btc_breakout_level ?? btcBreakoutLevel) > 0 && (
                    <div className="flex items-center justify-between py-1.5 border-b border-border/20">
                      <span className="text-muted-foreground">BTC MSB breakout at</span>
                      <span className="font-semibold mono-data" style={{ color: "oklch(0.78 0.18 75)" }}>
                        {formatUsd((entryStatus as any)?.btc_breakout_level ?? btcBreakoutLevel)}
                        {((entryStatus as any)?.btc_distance_pct ?? btcDistancePct) ? ` (${((entryStatus as any)?.btc_distance_pct ?? btcDistancePct).toFixed(1)}% away)` : ""}
                      </span>
                    </div>
                  )}
                  {/* Pending signal — emitted forecast / readiness, not synthesized */}
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-muted-foreground">Pending entry signal</span>
                    <span className="font-semibold mono-data text-foreground/80">{predictedAction || preparation?.readiness || "Monitoring"}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Regime soft-gate — DESCRIPTIVE only (no emitted active flag exists) */}
            {cashRisk && (
              <p className="text-xs text-muted-foreground/50 -mt-2">
                Regime soft-gate: confidence {regimeConf.toFixed(1)}% vs {(strategyParameters as any)?.regime_gate_conf ?? 65}% choppy-block threshold (descriptive — the script does not emit a soft-gate active flag).
              </p>
            )}

            {/* ══════════════════════════════════════════════════════════════════
                ⑥ REFERENCE — Key parameters + live-run stats (NOT a backtest)
            ══════════════════════════════════════════════════════════════════ */}
            <div className="panel p-5">
              <SectionTitle icon={<Layers size={14} className="text-primary opacity-70" />}>Reference — Parameters &amp; Live Run</SectionTitle>
              <div className="grid md:grid-cols-2 gap-6 text-sm">
                {/* Key parameters — emitted strategyParameters (static rule config) */}
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/60 mb-2">Key Parameters</p>
                  <div className="space-y-1.5">
                    {([
                      ["Min hold", (strategyParameters as any)?.min_hold_days != null ? `${(strategyParameters as any).min_hold_days} days` : `${minHoldDays} days`],
                      ["Stop loss", (strategyParameters as any)?.stop_loss_pct != null ? `−${(Number((strategyParameters as any).stop_loss_pct) * 100).toFixed(0)}%` : "−15%"],
                      ["Crash DD threshold", (strategyParameters as any)?.crash_dd_threshold != null ? `−${(Number((strategyParameters as any).crash_dd_threshold) * 100).toFixed(0)}%` : "−25%"],
                      ["Regime exit threshold", (strategyParameters as any)?.regime_exit_threshold != null ? `${(strategyParameters as any).regime_exit_threshold}% 30d mom` : "−5% 30d mom"],
                      ["Regime gate (choppy block)", (strategyParameters as any)?.regime_gate_conf != null ? `≥${(strategyParameters as any).regime_gate_conf}% conf` : "≥65% conf"],
                      ["Cash-out rate", (strategyParameters as any)?.cashout_rate != null ? `${(Number((strategyParameters as any).cashout_rate) * 100).toFixed(0)}% of profit` : "—"],
                      ["Rotation threshold", `+${rotThreshold} TFR pts`],
                      ["MSB pivot / ATR bars", (strategyParameters as any)?.msb_pivot_bars != null ? `${(strategyParameters as any).msb_pivot_bars} / ${(strategyParameters as any).msb_atr_period ?? "—"}` : "—"],
                    ] as Array<[string, string]>).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-semibold mono-data text-foreground/80">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Live run since inception — emitted scriptPerformance. NOT a backtest. */}
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/60 mb-2">
                    Live Run Since Inception ({(scriptPerformance as any)?.total_trades ?? performance?.counters?.totalTrades ?? 0} trades)
                  </p>
                  <div className="space-y-1.5">
                    {([
                      ["Win rate", (scriptPerformance as any)?.win_rate_pct != null ? `${Number((scriptPerformance as any).win_rate_pct).toFixed(1)}%` : "—"],
                      ["Rotations", (scriptPerformance as any)?.rotations],
                      ["Entries", (scriptPerformance as any)?.entries],
                      ["Regime exits", (scriptPerformance as any)?.regime_exits],
                      ["Stop losses", (scriptPerformance as any)?.stop_losses],
                      ["MSB exits", (scriptPerformance as any)?.msb_exits],
                      ["Crash exits", (scriptPerformance as any)?.crash_exits],
                      ["Rotations blocked by regime", (scriptPerformance as any)?.rotations_blocked_by_regime],
                    ] as Array<[string, unknown]>).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="font-semibold mono-data text-foreground/80">{v != null ? String(v) : "—"}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground/40 mt-2">Live trading results since strategy inception — not a backtest.</p>
                </div>
              </div>
            </div>

            {/* ── Trade history ── */}
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4 gap-4">
                <div>
                  <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>Trade History</h2>
                  <p className="text-xs text-muted-foreground mt-1">All BULL_ROTATE v4.1 signals from the droplet.</p>
                </div>
                <p className="text-xs text-muted-foreground mono-data">{history.length} records</p>
              </div>
              <div className="space-y-2">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trade history available yet. Run the script on your droplet to begin.</p>
                ) : history.slice(0, 20).map((row, index) => {
                  const pos    = String((row as any).position ?? (row as any).current_position ?? "—");
                  const act    = String((row as any).action ?? "—");
                  const reason = String((row as any).reason ?? "—");
                  const date   = String((row as any).date ?? (row as any).timestamp ?? `Record ${index + 1}`);
                  const val    = Number((row as any).portfolio_value ?? (row as any).portfolioValue ?? 0);
                  const posColor = ASSET_COLORS[pos] ?? "white";
                  const cashoutAmt = Number((row as any).cashout_amount ?? 0);
                  const regConf    = Number((row as any).regime_conf ?? 0);
                  const btcClose    = Number((row as any).btc_price ?? 0);
                  const rowEntryPx  = Number((row as any).entry_price ?? 0);
                  const rowStopLoss = rowEntryPx > 0 ? rowEntryPx * 0.85 : 0;
                  const msbSig      = String((row as any).msb_signal ?? "");
                  const msbStr     = String((row as any).msb_structure ?? "");
                  const isRotation = act === "ROTATE" || act === "REENTER_BTC" || act === "MSB_ENTRY_BTC" || act === "MSB_ENTRY_ETH";
                  const isStop     = act === "STOP_CASH" || act === "STOP_TO_BTC";
                  const isCrash    = act === "CRASH_EXIT";
                  const isMsbExit  = act === "MSB_EXIT";
                  const isCashout  = cashoutAmt > 0;
                  const tagColor   = isRotation ? toneColor("good") : isStop ? toneColor("warn") : isCrash ? toneColor("danger") : isMsbExit ? "oklch(0.62 0.22 25)" : "oklch(0.55 0.010 260)";
                  return (
                    <div key={`hist-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold mono-data text-muted-foreground">{date}</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${posColor}15`, color: posColor }}>{pos}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${tagColor}15`, color: tagColor }}>{act}</span>
                          {msbSig && msbSig !== "UNKNOWN" && (
                            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "oklch(0.60 0.22 255 / 12%)", color: "oklch(0.60 0.22 255)" }}>
                              MSB: {msbSig}
                            </span>
                          )}
                          {isCashout && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "oklch(0.82 0.18 95 / 15%)", color: "oklch(0.82 0.18 95)" }}>
                              +{formatLargeNumber(cashoutAmt)} to reserve
                            </span>
                          )}
                          {regConf >= 65 && (
                            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "oklch(0.78 0.18 75 / 12%)", color: "oklch(0.78 0.18 75)" }}>
                              Regime {regConf.toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-right flex-wrap justify-end">
                          {rowStopLoss > 0 && (
                            <span className="text-xs mono-data font-semibold px-2 py-0.5 rounded" style={{ background: "oklch(0.62 0.22 25 / 12%)", color: "oklch(0.62 0.22 25)", border: "1px solid oklch(0.62 0.22 25 / 25%)" }}>SL {formatUsd(rowStopLoss)}</span>
                          )}
                          {btcClose > 0 && (
                            <span className="text-xs mono-data font-semibold" style={{ color: "oklch(0.78 0.18 75)" }}>₿ {formatUsd(btcClose)}</span>
                          )}
                          {val > 0 && <span className="text-xs mono-data text-muted-foreground">{formatUsd(val)}</span>}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground pl-1">{reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
