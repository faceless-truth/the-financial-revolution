/**
 * Portfolio — Real Forward-Tracking Portfolio
 * Design: Dark Precision — same system as main dashboard
 *
 * Day 1 starts today with $71,400 capital.
 * State persists in localStorage and grows forward day by day.
 * Each day at 00:05 UTC the strategy signal is applied.
 */

import { useBinanceData } from "@/hooks/useBinanceData";
import { usePortfolio, resetPortfolio, type PersistedTrade } from "@/hooks/usePortfolio";
import { formatPrice, formatPct, formatLargeNumber, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  BarChart2,
  Zap,
  RotateCcw,
  CalendarDays,
} from "lucide-react";
import { Link } from "wouter";

// ── Shared helpers ─────────────────────────────────────────────────────────────
const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.65 0.18 255)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.70 0.20 200)",
  DOGE: "oklch(0.82 0.18 95)",
  CASH: "oklch(0.55 0.010 260)",
};

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "🌊", DOGE: "Ð", CASH: "$",
};

function pnlClass(v: number) {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-muted-foreground";
}

function PnlArrow({ v }: { v: number }) {
  if (v > 0) return <ArrowUpRight size={16} className="text-emerald-400" />;
  if (v < 0) return <ArrowDownRight size={16} className="text-red-400" />;
  return <Minus size={16} className="text-muted-foreground" />;
}

function StatCard({
  label, value, sub, color, icon,
}: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode;
}) {
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

function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const strat = payload.find((p: any) => p.dataKey === "value");
  const btc = payload.find((p: any) => p.dataKey === "btcHoldValue");
  return (
    <div className="rounded-lg border p-3 text-xs space-y-1" style={{ background: "oklch(0.13 0.012 260)", borderColor: "oklch(1 0 0 / 12%)" }}>
      <p className="text-muted-foreground font-semibold mb-2">{label}</p>
      {strat && (
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "oklch(0.72 0.18 155)" }} />
            Strategy
          </span>
          <span className="font-bold text-emerald-300 mono-data">{formatLargeNumber(strat.value)}</span>
        </div>
      )}
      {btc && (
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: "oklch(0.78 0.18 75)" }} />
            BTC Hold
          </span>
          <span className="font-bold text-amber-300 mono-data">{formatLargeNumber(btc.value)}</span>
        </div>
      )}
      {strat && btc && (
        <div className="flex items-center justify-between gap-4 border-t border-border/20 pt-1 mt-1">
          <span className="text-muted-foreground/60">Outperformance</span>
          <span className={`font-bold mono-data ${strat.value >= btc.value ? "text-emerald-400" : "text-red-400"}`}>
            {strat.value >= btc.value ? "+" : ""}{formatLargeNumber(strat.value - btc.value)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Portfolio() {
  const utils = trpc.useUtils();
  const { signal, loading: dataLoading, lastUpdated, rawData } = useBinanceData(5 * 60 * 1000);
  const manualTradesQuery = trpc.trade.getTrades.useQuery({ limit: 100 });
  const deleteTradeMutation = trpc.trade.deleteTrade.useMutation({
    onSuccess: async () => {
      await utils.trade.getTrades.invalidate();
    },
  });

  const manualTrades: PersistedTrade[] = manualTradesQuery.data ?? [];
  const portfolio = usePortfolio(signal, rawData, manualTrades);

  const loading = dataLoading || portfolio.loading || manualTradesQuery.isLoading;

  // Next execution countdown
  const nextExec = portfolio.nextActionDate ? new Date(portfolio.nextActionDate) : null;
  const hoursToNext = nextExec ? Math.max(0, Math.floor((nextExec.getTime() - Date.now()) / (1000 * 60 * 60))) : null;
  const minsToNext = nextExec ? Math.max(0, Math.floor(((nextExec.getTime() - Date.now()) % (1000 * 60 * 60)) / (1000 * 60))) : null;

  const assetColor = ASSET_COLORS[portfolio.currentAsset] ?? "oklch(0.55 0.010 260)";
  const activeMarketPrice = portfolio.currentAsset !== "CASH"
    ? rawData[portfolio.currentAsset as keyof typeof rawData]?.slice(-1)[0]?.close ?? 0
    : 0;
  const currentPositionLabel = portfolio.currentAsset === "CASH"
    ? "In cash"
    : `Live tracking ${portfolio.currentAsset}`;

  // isDay1: true only if we have exactly one equity point AND it's cash (no trade applied yet)
  const isDay1 = portfolio.equityCurve.length <= 1 && portfolio.currentAsset === "CASH" && portfolio.tradeLog.length === 0;

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b border-border/30"
        style={{ background: "oklch(0.13 0.012 260 / 95%)", backdropFilter: "blur(12px)" }}
      >
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
                <h1 className="text-base font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                  My Portfolio
                </h1>
                <p className="text-xs text-muted-foreground">
                  Started {portfolio.startDate} · Day {portfolio.daysTracked} · $71,400 capital
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw size={11} className={dataLoading ? "animate-spin" : ""} />
                <span>{timeAgo(lastUpdated)}</span>
              </div>
            )}
            {/* Reset button */}
            <button
              onClick={() => {
                if (confirm("Reset portfolio back to Day 1 ($71,400 capital)? This cannot be undone.")) {
                  resetPortfolio();
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
              style={{ borderColor: "oklch(1 0 0 / 12%)" }}
              title="Reset portfolio to Day 1"
            >
              <RotateCcw size={11} />
              <span className="hidden sm:inline">Reset</span>
            </button>
            {/* Current position pill */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold"
              style={{ background: `${assetColor}12`, borderColor: `${assetColor}30`, color: assetColor, fontFamily: "Syne, sans-serif" }}
            >
              <span>{ASSET_ICONS[portfolio.currentAsset] ?? portfolio.currentAsset}</span>
              <span>{portfolio.currentAsset}</span>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="container flex items-center gap-1 pb-0 pt-0 border-t border-border/20">
          <Link href="/">
            <div className="px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
              Strategy Dashboard
            </div>
          </Link>
          <div className="px-4 py-2.5 text-xs font-semibold border-b-2 cursor-default" style={{ color: "oklch(0.72 0.18 155)", borderColor: "oklch(0.72 0.18 155)" }}>
            My Portfolio
          </div>
        </div>
      </header>

      <div className="container py-6 space-y-6">

        {/* ── DAY 1 BANNER ─────────────────────────────────────────────────── */}
        {isDay1 && !loading && (
          <div
            className="p-4 rounded-xl border flex items-start gap-3"
            style={{ background: "oklch(0.60 0.22 255 / 8%)", borderColor: "oklch(0.60 0.22 255 / 25%)" }}
          >
            <CalendarDays size={18} style={{ color: "oklch(0.75 0.22 255)" }} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold" style={{ color: "oklch(0.85 0.22 255)" }}>
                Day 1 — Portfolio started today, {portfolio.startDate}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                $71,400 capital deployed. The strategy signal will be applied at the next{" "}
                <span className="text-white font-semibold mono-data">00:05 UTC</span> daily close window.
              </p>
            </div>
          </div>
        )}

        {/* ── ROW 1: Key stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
          ) : (
            <>
              <StatCard
                label="Portfolio Value"
                value={formatLargeNumber(portfolio.currentValue)}
                sub={`Day ${portfolio.daysTracked} · Started ${portfolio.startDate}`}
                color="oklch(0.72 0.18 155)"
                icon={<DollarSign size={14} />}
              />
              <StatCard
                label="Total P&L"
                value={`${portfolio.totalPnlUsd >= 0 ? "+" : ""}${formatLargeNumber(portfolio.totalPnlUsd)}`}
                sub={`${formatPct(portfolio.totalPnlPct)} since Day 1`}
                color={portfolio.totalPnlUsd >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"}
                icon={<PnlArrow v={portfolio.totalPnlUsd} />}
              />
              <StatCard
                label="vs BTC Buy & Hold"
                value={`${portfolio.outperformanceUsd >= 0 ? "+" : ""}${formatLargeNumber(portfolio.outperformanceUsd)}`}
                sub={`BTC hold would be: ${formatLargeNumber(portfolio.btcHoldValue)}`}
                color={portfolio.outperformanceUsd >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"}
                icon={<BarChart2 size={14} />}
              />
              <StatCard
                label="Next Execution"
                value={hoursToNext !== null ? `${hoursToNext}h ${minsToNext}m` : "—"}
                sub="Daily close → 00:05 UTC"
                color="oklch(0.60 0.22 255)"
                icon={<Clock size={14} />}
              />
            </>
          )}
        </div>

        {/* ── ROW 2: Equity curve ──────────────────────────────────────────── */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-400 opacity-70" />
              <div>
                <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                  Equity Curve
                </h2>
                <p className="text-xs text-muted-foreground">
                  Strategy vs BTC buy-and-hold · Starting {portfolio.startDate} · $71,400 capital
                </p>
              </div>
            </div>
            {!loading && portfolio.equityCurve.length > 1 && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ background: "oklch(0.72 0.18 155)" }} />
                  Strategy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ background: "oklch(0.78 0.18 75)" }} />
                  BTC Hold
                </span>
              </div>
            )}
          </div>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : isDay1 ? (
            <div
              className="h-64 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed"
              style={{ borderColor: "oklch(1 0 0 / 10%)", background: "oklch(1 0 0 / 2%)" }}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "oklch(0.72 0.18 155 / 10%)" }}>
                <TrendingUp size={22} style={{ color: "oklch(0.72 0.18 155)" }} />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground/70">Equity curve starts after first execution</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Come back after <span className="font-semibold mono-data text-foreground/60">00:05 UTC</span> to see your first data point
                </p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg border" style={{ background: "oklch(0.72 0.18 155 / 8%)", borderColor: "oklch(0.72 0.18 155 / 20%)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: "oklch(0.72 0.18 155)" }} />
                <span className="text-xs mono-data" style={{ color: "oklch(0.72 0.18 155)" }}>
                  Day 1 · {portfolio.startDate} · $71,400.00
                </span>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={portfolio.equityCurve.map((p) => ({ ...p, date: p.date.slice(5) }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="stratGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.72 0.18 155)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="oklch(0.72 0.18 155)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="btcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(0.78 0.18 75)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="oklch(0.78 0.18 75)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.max(0, Math.floor(portfolio.equityCurve.length / 8))}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => formatLargeNumber(v)}
                />
                <ReferenceLine
                  y={portfolio.startingCapital}
                  stroke="oklch(1 0 0 / 20%)"
                  strokeDasharray="4 2"
                  label={{ value: "$71.4k start", position: "insideTopLeft", fill: "oklch(0.55 0.010 260)", fontSize: 10 }}
                />
                <Tooltip content={<EquityTooltip />} />
                <Area type="monotone" dataKey="btcHoldValue" stroke="oklch(0.78 0.18 75)" strokeWidth={1.5} fill="url(#btcGrad)" strokeOpacity={0.7} dot={false} />
                <Area type="monotone" dataKey="value" stroke="oklch(0.72 0.18 155)" strokeWidth={2} fill="url(#stratGrad)" dot={false} activeDot={{ r: 4, fill: "oklch(0.72 0.18 155)" }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── ROW 3: Position + Signal ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Current Position */}
          <div className="panel p-5" style={{ borderColor: `${assetColor}20` }}>
            <div className="flex items-center gap-2 mb-4">
              <span style={{ color: assetColor, opacity: 0.7 }}><DollarSign size={14} /></span>
              <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
                Current Position
              </h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-40" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold"
                    style={{ background: `${assetColor}15`, border: `1px solid ${assetColor}30`, color: assetColor }}
                  >
                    {ASSET_ICONS[portfolio.currentAsset] ?? portfolio.currentAsset[0]}
                  </div>
                  <div>
                    <p className="text-xl font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                      {portfolio.currentAsset === "CASH" ? "CASH" : portfolio.currentAsset}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {portfolio.currentAsset === "CASH"
                        ? "Fully in cash — no live coin exposure right now"
                        : `${portfolio.currentUnits.toFixed(6)} units @ ${formatPrice(portfolio.entryPrice)}`}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: assetColor }}>
                      {currentPositionLabel}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg" style={{ background: "oklch(1 0 0 / 4%)" }}>
                    <p className="text-xs text-muted-foreground mb-1">Invested Value</p>
                    <p className="text-base font-bold mono-data text-white">{formatLargeNumber(portfolio.investedValue)}</p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: "oklch(1 0 0 / 4%)" }}>
                    <p className="text-xs text-muted-foreground mb-1">Cash Balance</p>
                    <p className="text-base font-bold mono-data text-white">{formatLargeNumber(portfolio.cashBalance)}</p>
                  </div>
                </div>

                {portfolio.currentAsset !== "CASH" ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                        <p className="text-xs text-muted-foreground mb-1">Live Price</p>
                        <p className="text-base font-bold mono-data text-white">{activeMarketPrice > 0 ? formatPrice(activeMarketPrice) : "—"}</p>
                      </div>
                      <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                        <p className="text-xs text-muted-foreground mb-1">Entry vs Live</p>
                        <p className={`text-base font-bold mono-data ${pnlClass(portfolio.unrealisedPnlPct)}`}>
                          {portfolio.entryPrice > 0 && activeMarketPrice > 0 ? formatPct(((activeMarketPrice / portfolio.entryPrice) - 1) * 100) : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Unrealised P&L</p>
                        <p className={`text-base font-bold mono-data ${pnlClass(portfolio.unrealisedPnlUsd)}`}>
                          {portfolio.unrealisedPnlUsd >= 0 ? "+" : ""}{formatLargeNumber(portfolio.unrealisedPnlUsd)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground mb-0.5">Return</p>
                        <p className={`text-base font-bold mono-data ${pnlClass(portfolio.unrealisedPnlPct)}`}>
                          {formatPct(portfolio.unrealisedPnlPct)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border" style={{ background: "oklch(0.60 0.22 255 / 7%)", borderColor: "oklch(0.60 0.22 255 / 18%)" }}>
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    <p className="text-sm font-semibold text-white">In cash — waiting for the next confirmed entry.</p>
                    <p className="text-xs text-muted-foreground mt-1">No live coin price is being tracked because the current portfolio is fully in cash.</p>
                  </div>
                )}

                {portfolio.currentAsset !== "CASH" && portfolio.entryDate && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Entry Date</span>
                      <span className="mono-data text-foreground/80">{portfolio.entryDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Days Held</span>
                      <span className="mono-data text-foreground/80">{portfolio.daysHeld} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Min-Hold Remaining</span>
                      <span className={`mono-data font-semibold ${portfolio.minHoldDaysRemaining === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                        {portfolio.minHoldDaysRemaining === 0 ? "✓ Free to rotate" : `${portfolio.minHoldDaysRemaining} days`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Today's Signal & Next Action */}
          <div className="panel p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={14} className="text-primary opacity-70" />
              <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
                Today's Signal & Next Action
              </h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : signal ? (
              <div className="space-y-4">
                <div
                  className="p-4 rounded-xl border"
                  style={{
                    background: signal.action === "HOLD" ? "oklch(0.60 0.22 255 / 8%)" : signal.action === "BUY" ? "oklch(0.72 0.18 155 / 8%)" : "oklch(0.62 0.22 25 / 8%)",
                    borderColor: signal.action === "HOLD" ? "oklch(0.60 0.22 255 / 25%)" : signal.action === "BUY" ? "oklch(0.72 0.18 155 / 25%)" : "oklch(0.62 0.22 25 / 25%)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-muted-foreground">Strategy Signal</p>
                    <span
                      className="text-sm font-bold px-3 py-1 rounded-lg"
                      style={{
                        fontFamily: "Syne, sans-serif",
                        background: signal.action === "HOLD" ? "oklch(0.60 0.22 255 / 15%)" : signal.action === "BUY" ? "oklch(0.72 0.18 155 / 15%)" : "oklch(0.62 0.22 25 / 15%)",
                        color: signal.action === "HOLD" ? "oklch(0.75 0.22 255)" : signal.action === "BUY" ? "oklch(0.72 0.18 155)" : "oklch(0.72 0.22 25)",
                      }}
                    >
                      {signal.action}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/80">{signal.reason}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">What this means for you</p>
                  <div className="p-3 rounded-lg border border-border/30" style={{ background: "oklch(1 0 0 / 3%)" }}>
                    {signal.action === "HOLD" && portfolio.currentAsset === "CASH" && (
                      <div className="flex items-start gap-2">
                        <CheckCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80">
                          Stay in cash. No action required at 00:05 UTC.
                        </p>
                      </div>
                    )}
                    {signal.action === "HOLD" && portfolio.currentAsset !== "CASH" && (
                      <div className="flex items-start gap-2">
                        <CheckCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80">
                          Hold your {portfolio.currentAsset} position.
                          {portfolio.minHoldDaysRemaining > 0 && ` Min-hold: ${portfolio.minHoldDaysRemaining} days remaining.`}
                        </p>
                      </div>
                    )}
                    {signal.action === "BUY" && portfolio.currentAsset === "CASH" && (
                      <div className="flex items-start gap-2">
                        <ArrowUpRight size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80">
                          <span className="font-semibold text-emerald-300">Buy signal.</span> At 00:05 UTC, deploy{" "}
                          <span className="font-semibold mono-data text-white">
                            {formatLargeNumber(portfolio.cashBalance * (Object.values(signal.targetPositions).reduce((a, b) => a + (b ?? 0), 0) || 1))}
                          </span>{" "}
                          into {Object.keys(signal.targetPositions).join(", ") || "BTC"}.
                        </p>
                      </div>
                    )}
                    {signal.action === "BUY" && portfolio.currentAsset !== "CASH" && (
                      <div className="flex items-start gap-2">
                        <CheckCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80">
                          Already invested. Hold current {portfolio.currentAsset} position.
                        </p>
                      </div>
                    )}
                    {signal.action === "SELL_ALL" && (
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-foreground/80">
                          <span className="font-semibold text-red-300">Cash trigger hit.</span> At 00:05 UTC, sell all positions and move to 100% cash.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-border/30" style={{ background: "oklch(1 0 0 / 3%)" }}>
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-primary opacity-70" />
                    <span className="text-xs text-muted-foreground">Next execution window</span>
                  </div>
                  <span className="text-sm font-bold mono-data" style={{ color: "oklch(0.60 0.22 255)", fontFamily: "Syne, sans-serif" }}>
                    {hoursToNext !== null ? `${hoursToNext}h ${minsToNext}m` : "—"} · 00:05 UTC
                  </span>
                </div>

                {Object.keys(signal.targetPositions).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Target Allocation at Next Execution</p>
                    <div className="space-y-1.5">
                      {Object.entries(signal.targetPositions).map(([asset, alloc]) => (
                        <div key={asset} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span style={{ color: ASSET_COLORS[asset] }}>{ASSET_ICONS[asset]}</span>
                            <span className="text-foreground/80">{asset}</span>
                          </span>
                          <span className="font-bold mono-data" style={{ color: ASSET_COLORS[asset] }}>
                            {formatLargeNumber(portfolio.currentValue * (alloc ?? 0))}
                            <span className="text-muted-foreground/60 font-normal ml-1">({((alloc ?? 0) * 100).toFixed(0)}%)</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── ROW 4: Manually Logged Trades ─────────────────────────────── */}
        <div className="panel p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={14} className="text-primary opacity-70" />
            <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
              My Logged Trades
            </h2>
            <span className="text-xs text-muted-foreground/50 ml-auto">
              {manualTrades.length} trade{manualTrades.length !== 1 ? "s" : ""} logged
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : manualTrades.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              <p className="font-semibold">No trades logged yet</p>
              <p className="text-xs mt-1 text-muted-foreground/50">
                Use the &ldquo;Log my buy/sell price&rdquo; button on the Strategy Dashboard to record your actual execution prices.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/20">
                    <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Date &amp; Time</th>
                    <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Type</th>
                    <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Asset</th>
                    <th className="text-right py-2 text-muted-foreground/60 font-medium pr-4">Exec. Price</th>
                    <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Signal</th>
                    <th className="text-left py-2 text-muted-foreground/60 font-medium">Notes</th>
                    <th className="text-right py-2 text-muted-foreground/60 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {manualTrades.map((trade) => (
                    <tr key={trade.id} className="border-b border-border/10 hover:bg-white/2 transition-colors">
                      <td className="py-2.5 pr-4 mono-data text-muted-foreground/70 whitespace-nowrap">
                        {new Date(trade.executedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: true, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-bold uppercase"
                          style={{
                            background: trade.tradeType === "buy" ? "oklch(0.72 0.18 155 / 15%)" : "oklch(0.62 0.22 25 / 15%)",
                            color: trade.tradeType === "buy" ? "oklch(0.72 0.18 155)" : "oklch(0.72 0.22 25)",
                          }}
                        >
                          {trade.tradeType}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-1.5">
                          <span style={{ color: ASSET_COLORS[trade.asset] }}>{ASSET_ICONS[trade.asset] ?? trade.asset[0]}</span>
                          <span className="font-semibold text-foreground/80">{trade.asset}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-right mono-data text-foreground/80 font-semibold">{formatPrice(trade.price)}</td>
                      <td className="py-2.5 pr-4">
                        <span className="text-muted-foreground/60 uppercase text-xs">{trade.signalAction.replace("_", " ")}</span>
                      </td>
                      <td className="py-2.5 text-muted-foreground/60 max-w-xs truncate">{trade.notes ?? "—"}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => {
                            if (confirm("Delete this trade entry?")) {
                              deleteTradeMutation.mutate({ id: trade.id });
                            }
                          }}
                          className="text-muted-foreground/30 hover:text-red-400 transition-colors text-xs px-1"
                          title="Delete trade"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="border-t border-border/20 pt-4 pb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/40">
            <p>The Financial Revolution · Portfolio tracking based on live Binance data · Not financial advice</p>
            <p className="mono-data">Execution at 00:05 UTC daily · State persists across sessions</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
