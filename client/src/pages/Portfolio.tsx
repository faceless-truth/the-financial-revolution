import { useEffect, useMemo, useState } from "react";
import { formatLargeNumber, formatPct, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  TrendingUp,
  DollarSign,
  Clock,
  ArrowUpRight,
  Shield,
  Activity,
  BellRing,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.65 0.18 255)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.70 0.20 200)",
  DOGE: "oklch(0.82 0.18 95)",
  CASH: "oklch(0.55 0.010 260)",
};

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
  SUI: "◈",
  DOGE: "Ð",
  CASH: "$",
};

function readinessMeta(readiness: string) {
  switch (readiness) {
    case "NO_ACTION":
      return { label: "No Action", color: "oklch(0.58 0.03 260)", icon: <CheckCircle2 size={14} /> };
    case "WATCH":
      return { label: "Watch", color: "oklch(0.78 0.18 75)", icon: <BellRing size={14} /> };
    case "PREPARE":
      return { label: "Prepare", color: "oklch(0.72 0.18 155)", icon: <AlertTriangle size={14} /> };
    case "NEAR_TRIGGER":
      return { label: "Near Trigger", color: "oklch(0.62 0.22 25)", icon: <Activity size={14} /> };
    default:
      return { label: readiness || "Watch", color: "oklch(0.60 0.22 255)", icon: <BellRing size={14} /> };
  }
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: color ? `${color}25` : undefined }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {icon && <span className="opacity-50">{icon}</span>}
      </div>
      <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: color ?? "white" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground/60 mono-data">{sub}</p>}
    </div>
  );
}

function ScoreList({ title, rows, accent }: { title: string; rows: Array<{ asset?: string; symbol?: string; score?: number }>; accent: string }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={14} style={{ color: accent, opacity: 0.8 }} />
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>{title}</h2>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const asset = row.asset ?? row.symbol ?? "—";
          const score = Number(row.score ?? 0);
          return (
            <div key={`${title}-${asset}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground/50 w-4">{index + 1}</span>
                <span style={{ color: ASSET_COLORS[asset] ?? accent }}>{ASSET_ICONS[asset] ?? asset[0]}</span>
                <span className="font-semibold text-foreground/85">{asset}</span>
              </div>
              <span className="mono-data font-bold" style={{ color: ASSET_COLORS[asset] ?? accent }}>{score.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type LivePortfolioSnapshot = {
  source?: { root?: string };
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
  };
  preparation?: {
    readiness?: string;
    label?: string;
    note?: string;
    targetAsset?: string;
    topCandidates?: Array<{ asset?: string; symbol?: string; score?: number }>;
    scenario?: Record<string, unknown>;
  };
  planning?: {
    currentBlocker?: string;
    rule2Active?: boolean;
    rule3Active?: boolean;
    rule4Ready?: boolean | null;
    latestThirtyDayHighDateUtc?: string;
    blockExpiresAfterCloseUtc?: string;
    earliestEligibleRunUtc?: string;
    earliestEligibleRunLabel?: string;
    candidateAsset?: string;
    currentAsset?: string;
    holdDays?: number;
    nextActionSummary?: string;
  };
  tradeHistory?: Array<Record<string, unknown>>;
};

export default function Portfolio() {
  const [data, setData] = useState<LivePortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        const response = await fetch("/api/live-portfolio", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!cancelled) setData(json);
      } catch (error) {
        console.error("Failed to load live portfolio", error);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSnapshot();
    const interval = setInterval(loadSnapshot, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const summary = data?.summary;
  const performance = data?.performance;
  const preparation = data?.preparation;
  const planning = data?.planning;
  const history = useMemo(() => (Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : []), [data]);
  const currentAsset = summary?.currentAsset ?? "CASH";
  const assetColor = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;
  const prep = readinessMeta(preparation?.readiness ?? "WATCH");

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
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
                <p className="text-xs text-muted-foreground">Live droplet mirror · Fixed capital {loading ? "—" : formatLargeNumber(summary?.fixedCapitalUsd ?? 71_000)}</p>
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
          <Link href="/">
            <div className="px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors">Strategy Dashboard</div>
          </Link>
          <div className="px-4 py-2.5 text-xs font-semibold border-b-2 cursor-default" style={{ color: "oklch(0.72 0.18 155)", borderColor: "oklch(0.72 0.18 155)" }}>My Portfolio</div>
        </div>
      </header>

      <div className="container py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !data || !summary || !performance || !preparation ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live portfolio snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please refresh the page. If the issue persists, verify that the live portfolio API is responding.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Portfolio Value" value={formatLargeNumber(summary.displayedPortfolioValueUsd ?? 0)} sub={`Live script value ${formatLargeNumber(summary.liveStrategyValueUsd ?? summary.displayedPortfolioValueUsd ?? 0)}`} color="oklch(0.72 0.18 155)" icon={<DollarSign size={14} />} />
              <StatCard label="Total P&L" value={`${(summary.pnlUsd ?? 0) >= 0 ? "+" : ""}${formatLargeNumber(summary.pnlUsd ?? 0)}`} sub={`${formatPct(summary.totalReturnPct ?? 0)} vs fixed ${formatLargeNumber(summary.fixedCapitalUsd ?? 71_000)}`} color={(summary.pnlUsd ?? 0) >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"} icon={<ArrowUpRight size={14} />} />
              <StatCard label="Current Signal" value={summary.signalAction ?? "HOLD"} sub={summary.ruleReason ?? "Live droplet mirror"} color={assetColor} icon={<Activity size={14} />} />
              <StatCard label="Market Regime" value={summary.marketRegime ?? "LIVE"} sub={`Confidence ${summary.regimeConfidence ?? "—"} · ${summary.confidenceLabel ?? "Live"}`} color="oklch(0.60 0.22 255)" icon={<Shield size={14} />} />
            </div>

            <div className="panel p-5" style={{ borderColor: `${prep.color}25`, background: `${prep.color}06` }}>
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-1">Preparation State</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ color: prep.color }}>{prep.icon}</span>
                    <h2 className="text-xl font-bold" style={{ fontFamily: "Syne, sans-serif", color: prep.color }}>{preparation.label ?? prep.label}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground max-w-2xl">{preparation.note ?? summary.ruleReason}</p>
                </div>
                <div className="panel px-4 py-3 min-w-[220px]" style={{ background: "oklch(0.10 0.010 260 / 55%)" }}>
                  <p className="text-xs text-muted-foreground mb-1">Current position</p>
                  <p className="text-lg font-bold" style={{ fontFamily: "Syne, sans-serif", color: assetColor }}>{currentAsset}</p>
                  <p className="text-xs text-muted-foreground mt-1">Hold days {summary.holdDays ?? 0}{summary.entryDate ? ` · Entered ${summary.entryDate}` : ""}</p>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <ScoreList title="Top Candidates" rows={preparation.topCandidates ?? []} accent={prep.color} />
                <div className="panel p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield size={14} style={{ color: prep.color, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Rotation Readiness</h2>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p><span className="text-foreground font-semibold">Current blocker:</span> {planning?.currentBlocker ?? "Monitoring live conditions"}</p>
                    <p><span className="text-foreground font-semibold">Candidate:</span> {planning?.candidateAsset ?? preparation?.targetAsset ?? "Watching leaders"}</p>
                    <p><span className="text-foreground font-semibold">Earliest eligible run:</span> {planning?.earliestEligibleRunLabel ?? "Watching next close"}</p>
                    <p><span className="text-foreground font-semibold">Rule 4:</span> {planning?.rule4Ready === true ? "Ready" : planning?.rule4Ready === false ? "Pending confirmation" : "Monitoring"}</p>
                    <p>{planning?.nextActionSummary ?? "Live planning state will update as daily closes change."}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <StatCard label="BTC Hold Benchmark" value={formatLargeNumber(performance.btcHoldValueUsd ?? 0)} sub="Passive BTC benchmark" icon={<TrendingUp size={14} />} />
              <StatCard label="Outperformance" value={`${(performance.outperformanceUsd ?? 0) >= 0 ? "+" : ""}${formatLargeNumber(performance.outperformanceUsd ?? 0)}`} sub={`${formatPct(performance.outperformancePct ?? 0)} vs BTC hold`} color={(performance.outperformanceUsd ?? 0) >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"} icon={<ArrowUpRight size={14} />} />
              <StatCard label="Unrealised P&L" value={`${(performance.unrealisedPnlUsd ?? 0) >= 0 ? "+" : ""}${formatLargeNumber(performance.unrealisedPnlUsd ?? 0)}`} sub={`${formatPct(performance.unrealisedPnlPct ?? 0)} on current position`} color={(performance.unrealisedPnlUsd ?? 0) >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"} icon={<DollarSign size={14} />} />
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4 gap-4">
                <div>
                  <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>Recent Signal History</h2>
                  <p className="text-xs text-muted-foreground mt-1">Latest live script records from the droplet mirror.</p>
                </div>
                <p className="text-xs text-muted-foreground mono-data">{history.length} records</p>
              </div>
              <div className="space-y-3">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No signal history available.</p>
                ) : history.slice(0, 10).map((row, index) => (
                  <div key={`hist-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <p className="text-sm font-semibold text-foreground mono-data">{String((row as any).timestamp ?? (row as any).date ?? `Record ${index + 1}`)}</p>
                      <p className="text-xs text-muted-foreground">{String((row as any).action ?? (row as any).signalAction ?? (row as any).ruleTriggered ?? "—")}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{String((row as any).reason ?? (row as any).notes ?? (row as any).ruleReason ?? "No reason supplied")}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
