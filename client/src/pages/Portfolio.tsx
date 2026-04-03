import { useState, useEffect, useMemo } from "react";
import { formatLargeNumber, formatPct, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

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
  };
  ranking?: Array<{ asset: string; score: number; mom30: number; price: number; color: string; icon: string }>;
  tradeHistory?: Array<Record<string, unknown>>;
};

type MsbSnapshot = {
  lastUpdate: string;
  signals: MsbAssetSignal[];
  available: boolean;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const [data, setData]       = useState<LivePortfolioSnapshot | null>(null);
  const [msb,  setMsb]        = useState<MsbSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [portfolioRes, msbRes] = await Promise.all([
          fetch("/api/live-portfolio",  { headers: { Accept: "application/json" } }),
          fetch("/api/msb-signals",     { headers: { Accept: "application/json" } }),
        ]);
        if (!portfolioRes.ok) throw new Error(`Portfolio HTTP ${portfolioRes.status}`);
        const portfolioJson = await portfolioRes.json();
        if (!cancelled) setData(portfolioJson);

        if (msbRes.ok) {
          const msbJson = await msbRes.json();
          if (!cancelled) setMsb(msbJson);
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

  const summary     = data?.summary;
  const performance = data?.performance;
  const preparation = data?.preparation;
  const planning    = data?.planning;
  const cashRisk    = data?.cashRisk;
  const ranking     = data?.ranking ?? [];
  const history     = useMemo(() => (Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : []), [data]);
  const msbSignals  = msb?.signals ?? [];

  const currentAsset = summary?.currentAsset ?? "CASH";
  const assetColor   = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;

  const portfolioVal      = summary?.displayedPortfolioValueUsd ?? 67428;
  const reserveUsd        = (summary as any)?.reserveUsd ?? 0;
  const totalWealthUsd    = (summary as any)?.totalWealthUsd ?? portfolioVal + reserveUsd;
  const totalWealthRetPct = (summary as any)?.totalWealthReturnPct ?? ((totalWealthUsd - 67428) / 67428 * 100);
  const fixedCap          = summary?.fixedCapitalUsd ?? 67428;
  // Use currentPositionValueUsd (1.0004 BTC × live price) for P&L — NOT the stale state file value
  // currentPositionValueUsd is resolved below after performance is read, so we defer pnlUsd
  const pnlColor          = (v: number) => v >= 0 ? toneColor("good") : toneColor("danger");
  const regimeConf        = (summary as any)?.regimeConf ?? 0;
  const regimeLabel       = (summary as any)?.regimeLabel ?? (regimeConf >= 65 ? "Range-Bound" : regimeConf >= 45 ? "Transitioning" : "Trending");
  const regimeTone        = (summary as any)?.regimeTone ?? (regimeConf >= 65 ? "warn" : regimeConf >= 45 ? "neutral" : "good");

  const entryPrice              = summary?.entryPrice ?? 0;
  const currentPrice            = (performance as any)?.currentAssetPrice
    ?? ranking.find(r => r.asset === currentAsset)?.price ?? 0;
  const unrealisedPnlUsd        = (performance as any)?.unrealisedPnlUsd ?? 0;
  const unrealisedPct           = (performance as any)?.unrealisedPnlPct
    ?? (entryPrice > 0 && currentPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0);
  const currentPositionValueUsd = (performance as any)?.currentPositionValueUsd ?? portfolioVal;
  const unrealisedColor         = unrealisedPct >= 0 ? toneColor("good") : toneColor("danger");

  // Active portfolio P&L: currentPositionValueUsd vs fixed capital $67,428
  const pnlUsd = currentPositionValueUsd - fixedCap;
  const pnlPct = fixedCap > 0 ? (pnlUsd / fixedCap) * 100 : 0;

  const lastTrade        = (performance as any)?.lastTrade ?? {};
  const lastTradeAction  = lastTrade.action ?? "";
  const lastTradeDate    = lastTrade.date ?? "";
  const lastTradePos     = lastTrade.position ?? "";
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
                <p className="text-xs text-muted-foreground">BULL_ROTATE v3.0 · Fixed capital {loading ? "—" : formatUsd(fixedCap)}</p>
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
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !data || !summary ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live portfolio snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please refresh the page. If the issue persists, verify that the live portfolio API is responding.</p>
          </div>
        ) : (
          <>
            {/* ── Top stat cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Active Portfolio" value={formatLargeNumber(currentPositionValueUsd)} sub={`${pnlUsd >= 0 ? "+" : ""}${formatLargeNumber(pnlUsd)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`} color={pnlColor(pnlUsd)} icon={<DollarSign size={14} />} />
              <StatCard label="Reserve (Cashed Out)" value={formatLargeNumber(reserveUsd)} sub={reserveUsd > 0 ? "Profit locked in — ready to redeploy" : "No profits cashed out yet"} color="oklch(0.82 0.18 95)" icon={<ArrowUpRight size={14} />} />
              <StatCard label="Total Wealth" value={formatLargeNumber(totalWealthUsd)} sub={`${totalWealthRetPct >= 0 ? "+" : ""}${totalWealthRetPct.toFixed(2)}% vs $67,428 start`} color="oklch(0.72 0.18 155)" icon={<TrendingUp size={14} />} />
              <StatCard
                label="Unrealised P&L"
                value={`${unrealisedPnlUsd >= 0 ? "+" : "-"}${formatUsd(Math.abs(unrealisedPnlUsd))}`}
                sub={`${unrealisedPct >= 0 ? "+" : ""}${unrealisedPct.toFixed(2)}% · Entry ${formatUsd(entryPrice)} · 1.0004 BTC`}
                color={unrealisedColor}
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
                <p className="text-xs text-muted-foreground/60 mono-data">{regimeConf > 0 ? `${regimeConf.toFixed(1)}% range confidence` : "Awaiting data"}</p>
              </div>
              <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: regimeConf >= 65 ? "oklch(0.78 0.18 75 / 25%)" : "oklch(0.72 0.18 155 / 25%)" }}>
                <p className="text-xs text-muted-foreground">Regime Gate</p>
                <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: regimeConf >= 65 ? toneColor("warn") : toneColor("good") }}>{regimeConf >= 65 ? "BLOCKING" : "CLEAR"}</p>
                <p className="text-xs text-muted-foreground/60 mono-data">{regimeConf >= 65 ? "Alt rotations blocked" : "Alt rotations eligible"}</p>
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
                  <p className="text-sm text-muted-foreground max-w-2xl">{preparation?.note ?? summary.ruleReason}</p>
                </div>
                <div className="panel px-4 py-3 min-w-[220px]" style={{ background: "oklch(0.10 0.010 260 / 55%)" }}>
                  <p className="text-xs text-muted-foreground mb-1">Last signal</p>
                  <p className="text-lg font-bold" style={{ fontFamily: "Syne, sans-serif", color: assetColor }}>{summary.signalAction ?? "HOLD"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{summary.ruleReason ?? "—"}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                {/* Momentum ranking */}
                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={14} style={{ color: assetColor, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Composite Momentum Ranking</h2>
                  </div>
                  <div className="space-y-2">
                    {ranking.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No ranking data available.</p>
                    ) : ranking.map((row, i) => (
                      <div key={row.asset} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/50 w-4">{i + 1}</span>
                          <span style={{ color: row.color }}>{row.icon}</span>
                          <span className="font-semibold text-foreground/85">{row.asset}</span>
                        </div>
                        <div className="text-right">
                          <span className="mono-data font-bold text-sm" style={{ color: row.color }}>{row.score.toFixed(2)}</span>
                          <p className="text-xs text-muted-foreground">{row.mom30 >= 0 ? "+" : ""}{row.mom30.toFixed(1)}% 30d</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground/50 mt-3">Composite = 50% × 30d + 30% × 14d + 20% × 7d momentum. Rotation fires when alt leads BTC by 30pp.</p>
                </div>

                {/* Rotation readiness */}
                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield size={14} style={{ color: assetColor, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Rotation Readiness</h2>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p><span className="text-foreground font-semibold">Status:</span> {preparation?.label ?? "Monitoring"}</p>
                    <p><span className="text-foreground font-semibold">Candidate:</span> {planning?.candidateAsset ?? preparation?.targetAsset ?? "None above 30pp threshold"}</p>
                    <p><span className="text-foreground font-semibold">Blocker:</span> {planning?.currentBlocker ?? "None"}</p>
                    <p><span className="text-foreground font-semibold">Min hold:</span> {planning?.rule2Active ? `Active — ${planning.earliestEligibleRunLabel ?? "clearing soon"}` : "Clear"}</p>
                    <p><span className="text-foreground font-semibold">Rotation threshold:</span> 30pp composite score lead over BTC</p>
                    <p className="text-xs">{planning?.nextActionSummary ?? "Monitoring daily closes for rotation signal."}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                MSB SIGNAL PANEL — Market Structure Break Analysis
            ══════════════════════════════════════════════════════════════════ */}
            <div className="panel p-5" style={{ borderColor: "oklch(0.60 0.22 255 / 25%)" }}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Layers size={16} style={{ color: "oklch(0.60 0.22 255)" }} />
                  <div>
                    <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>MSB Signal Panel</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Market Structure Break analysis · Pivot highs/lows · Breakout levels</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {msb?.lastUpdate && (
                    <span className="text-xs text-muted-foreground hidden sm:block">{timeAgo(new Date(msb.lastUpdate))}</span>
                  )}
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full" style={{ background: "oklch(0.72 0.18 155)" }} />
                    <span className="text-muted-foreground">Bullish Break</span>
                    <span className="w-2 h-2 rounded-full ml-2" style={{ background: "oklch(0.62 0.22 25)" }} />
                    <span className="text-muted-foreground">Bearish Break</span>
                    <span className="w-2 h-2 rounded-full ml-2" style={{ background: "oklch(0.60 0.22 255)" }} />
                    <span className="text-muted-foreground">Ranging</span>
                  </div>
                </div>
              </div>

              {/* MSB explanation */}
              <div className="rounded-lg p-3 mb-5 text-xs text-muted-foreground" style={{ background: "oklch(0.60 0.22 255 / 6%)", border: "1px solid oklch(0.60 0.22 255 / 15%)" }}>
                <span className="text-foreground font-semibold">How to read this panel: </span>
                A <span style={{ color: "oklch(0.72 0.18 155)" }}>Bullish MSB</span> fires when price closes above a confirmed pivot high + ATR buffer — structure has broken upward.
                A <span style={{ color: "oklch(0.62 0.22 25)" }}>Bearish MSB</span> fires when price closes below a confirmed pivot low − ATR buffer — structure has broken downward.
                In v3.0, a Bearish MSB on your held asset triggers an immediate exit. A Bullish MSB on BTC/ETH triggers entry from cash.
                Pivot highs/lows are confirmed using {5} bars on each side.
              </div>

              {msbSignals.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4 text-center">
                  MSB signals not yet available. They will appear after the first v3.0 script run on your droplet.
                </div>
              ) : (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {msbSignals.map(s => <MsbAssetCard key={s.asset} s={s} />)}
                </div>
              )}
            </div>

            {/* ── Performance stats ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Total Return (Active)" value={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`} sub={`${pnlUsd >= 0 ? "+" : ""}${formatUsd(pnlUsd)} active portfolio`} color={pnlColor(pnlUsd)} icon={<TrendingUp size={14} />} />
              <StatCard label="Total Return (Wealth)" value={`${totalWealthRetPct >= 0 ? "+" : ""}${totalWealthRetPct.toFixed(2)}%`} sub={`Portfolio + reserve vs ${formatUsd(fixedCap)} start`} color="oklch(0.72 0.18 155)" icon={<TrendingUp size={14} />} />
              <StatCard label="Total Trades" value={String(performance?.counters?.totalTrades ?? 0)} sub={`${performance?.counters?.rotations ?? 0} rotations · ${performance?.counters?.stopFires ?? 0} stops · ${performance?.counters?.crashExits ?? 0} crashes`} color="oklch(0.60 0.22 255)" icon={<Zap size={14} />} />
              <StatCard label="Cash-Out Events" value={String((performance?.counters as any)?.cashoutFires ?? 0)} sub={`${formatLargeNumber((performance?.counters as any)?.totalCashedOut ?? 0)} total cashed out to reserve`} color="oklch(0.82 0.18 95)" icon={<DollarSign size={14} />} />
            </div>

            {/* ── Cash risk summary ── */}
            {cashRisk && (
              <div className="panel p-5">
                <SectionTitle icon={<Shield size={14} className="text-primary opacity-70" />}>Cash Risk Summary</SectionTitle>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div className="space-y-2">
                    <p><span className="text-foreground font-semibold">Cash status:</span> <span style={{ color: toneColor(cashRisk.statusTone ?? "good") }}>{cashRisk.statusLabel}</span></p>
                    <p><span className="text-foreground font-semibold">BTC 30d drawdown:</span> {cashRisk.btcDd30 != null ? `${(cashRisk.btcDd30 * 100).toFixed(1)}%` : "—"}</p>
                    <p><span className="text-foreground font-semibold">Distance to crash exit:</span> {cashRisk.distanceToCrash != null ? `${cashRisk.distanceToCrash.toFixed(1)}pp` : "—"}</p>
                  </div>
                  <div className="space-y-2">
                    <p><span className="text-foreground font-semibold">BTC 30d high:</span> {formatUsd(cashRisk.btc30dHigh)}</p>
                    <p><span className="text-foreground font-semibold">Crash exit level:</span> {formatUsd(cashRisk.crashExitLevel)}</p>
                    <p><span className="text-foreground font-semibold">Stop loss level:</span> {cashRisk.stopLossLevel ? formatUsd(cashRisk.stopLossLevel) : "—"}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Trade history ── */}
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4 gap-4">
                <div>
                  <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>Trade History</h2>
                  <p className="text-xs text-muted-foreground mt-1">All BULL_ROTATE v3.0 signals from the droplet.</p>
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
                  const btcClose   = Number((row as any).btc_price ?? 0);
                  const msbSig     = String((row as any).msb_signal ?? "");
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
                        <div className="flex items-center gap-2 text-right">
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
