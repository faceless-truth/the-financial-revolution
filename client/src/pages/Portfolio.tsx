import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

// ── Asset palette ─────────────────────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC:  "oklch(0.78 0.18 75)",
  ETH:  "oklch(0.65 0.18 255)",
  DOGE: "oklch(0.82 0.18 95)",
  CASH: "oklch(0.55 0.010 260)",
};

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", DOGE: "Ð", CASH: "$",
};

function toneColor(tone: "good" | "warn" | "danger" | "neutral") {
  switch (tone) {
    case "good":   return "oklch(0.72 0.18 155)";
    case "warn":   return "oklch(0.78 0.18 75)";
    case "danger": return "oklch(0.62 0.22 25)";
    default:       return "oklch(0.60 0.22 255)";
  }
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
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

// ── Page ──────────────────────────────────────────────────────────────────────

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
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const summary     = data?.summary;
  const performance = data?.performance;
  const preparation = data?.preparation;
  const planning    = data?.planning;
  const cashRisk    = data?.cashRisk;
  const ranking     = data?.ranking ?? [];
  const history     = useMemo(() => (Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : []), [data]);

  const currentAsset = summary?.currentAsset ?? "CASH";
  const assetColor   = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;

  const portfolioVal = summary?.displayedPortfolioValueUsd ?? 10000;
  const fixedCap     = summary?.fixedCapitalUsd ?? 10000;
  const pnlUsd       = portfolioVal - fixedCap;
  const pnlPct       = fixedCap > 0 ? (pnlUsd / fixedCap) * 100 : 0;
  const pnlColor     = pnlUsd >= 0 ? toneColor("good") : toneColor("danger");

  // Current position unrealised P&L
  const entryPrice   = summary?.entryPrice ?? 0;
  const currentPrice = ranking.find(r => r.asset === currentAsset)?.price ?? 0;
  const unrealisedPct = entryPrice > 0 && currentPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : 0;
  const unrealisedColor = unrealisedPct >= 0 ? toneColor("good") : toneColor("danger");

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
                <p className="text-xs text-muted-foreground">BULL_ROTATE v2.0 · Fixed capital {loading ? "—" : formatUsd(fixedCap)}</p>
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
        ) : !data || !summary ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live portfolio snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please refresh the page. If the issue persists, verify that the live portfolio API is responding.</p>
          </div>
        ) : (
          <>
            {/* ── Top stat cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Portfolio Value" value={formatLargeNumber(portfolioVal)} sub={`Fixed capital ${formatUsd(fixedCap)}`} color="oklch(0.72 0.18 155)" icon={<DollarSign size={14} />} />
              <StatCard label="Total P&L" value={`${pnlUsd >= 0 ? "+" : ""}${formatLargeNumber(pnlUsd)}`} sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% since inception`} color={pnlColor} icon={<ArrowUpRight size={14} />} />
              <StatCard label="Current Position" value={currentAsset} sub={summary.entryDate ? `Entered ${summary.entryDate} · ${summary.holdDays ?? 0}d held` : "Awaiting position"} color={assetColor} icon={<Activity size={14} />} />
              <StatCard label="Unrealised P&L" value={`${unrealisedPct >= 0 ? "+" : ""}${unrealisedPct.toFixed(2)}%`} sub={entryPrice > 0 ? `Entry ${formatUsd(entryPrice)}` : "No open position"} color={unrealisedColor} icon={<BarChart2 size={14} />} />
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

            {/* ── Performance stats ── */}
            <div className="grid lg:grid-cols-3 gap-4">
              <StatCard label="Total Return" value={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`} sub={`${pnlUsd >= 0 ? "+" : ""}${formatUsd(pnlUsd)} vs ${formatUsd(fixedCap)} fixed capital`} color={pnlColor} icon={<TrendingUp size={14} />} />
              <StatCard label="Total Trades" value={String(performance?.counters?.totalTrades ?? 0)} sub={`${performance?.counters?.rotations ?? 0} rotations · ${performance?.counters?.stopFires ?? 0} stops · ${performance?.counters?.crashExits ?? 0} crashes`} color="oklch(0.60 0.22 255)" icon={<Zap size={14} />} />
              <StatCard label="Days in Cash" value={String(performance?.counters?.cashDays ?? 0)} sub="Total days strategy held CASH" color="oklch(0.55 0.010 260)" icon={<Shield size={14} />} />
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
                  <p className="text-xs text-muted-foreground mt-1">All BULL_ROTATE v2.0 signals from the droplet.</p>
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
                  const isRotation = act === "ROTATE" || act === "REENTER_BTC";
                  const isStop     = act === "STOP_CASH" || act === "STOP_TO_BTC";
                  const isCrash    = act === "CRASH_EXIT";
                  const tagColor   = isRotation ? toneColor("good") : isStop ? toneColor("warn") : isCrash ? toneColor("danger") : "oklch(0.55 0.010 260)";
                  return (
                    <div key={`hist-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold mono-data text-muted-foreground">{date}</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${posColor}15`, color: posColor }}>{pos}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${tagColor}15`, color: tagColor }}>{act}</span>
                        </div>
                        {val > 0 && <span className="text-xs mono-data text-muted-foreground">{formatUsd(val)}</span>}
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
