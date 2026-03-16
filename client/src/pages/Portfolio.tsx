import { trpc } from "@/lib/trpc";
import { formatLargeNumber, formatPct, formatPrice, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  TrendingUp,
  DollarSign,
  Clock,
  ArrowUpRight,
  Minus,
  BarChart2,
  Zap,
  Shield,
  Activity,
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

function pnlClass(v: number) {
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-red-400";
  return "text-muted-foreground";
}

function StatCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon?: React.ReactNode;
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

function ScoreList({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: Array<{ asset: string; score: number }>;
  accent: string;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={14} style={{ color: accent, opacity: 0.8 }} />
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
          {title}
        </h2>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={`${title}-${row.asset}`} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground/50 w-4">{index + 1}</span>
              <span style={{ color: ASSET_COLORS[row.asset] ?? accent }}>{ASSET_ICONS[row.asset] ?? row.asset[0]}</span>
              <span className="font-semibold text-foreground/85">{row.asset}</span>
            </div>
            <span className="mono-data font-bold" style={{ color: ASSET_COLORS[row.asset] ?? accent }}>{row.score.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Portfolio() {
  const snapshotQuery = trpc.livePortfolio.getSnapshot.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });

  const data = snapshotQuery.data;
  const loading = snapshotQuery.isLoading;
  const summary = data?.summary;
  const performance = data?.performance;
  const history = data?.tradeHistory ?? [];
  const currentAsset = summary?.currentAsset ?? "CASH";
  const assetColor = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
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
                  Live droplet mirror · Fixed capital {loading ? "—" : formatLargeNumber(summary?.fixedCapitalUsd ?? 71_000)}
                </p>
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
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold"
              style={{ background: `${assetColor}12`, borderColor: `${assetColor}30`, color: assetColor, fontFamily: "Syne, sans-serif" }}
            >
              <span>{ASSET_ICONS[currentAsset] ?? currentAsset}</span>
              <span>{currentAsset}</span>
            </div>
          </div>
        </div>

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
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : !data || !summary || !performance ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live portfolio snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">
              Make sure the website process can read the droplet JSON files under {data?.source.root ?? "/root/crypto_dashboard"}.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Portfolio Value"
                value={formatLargeNumber(summary.displayedPortfolioValueUsd)}
                sub={`Live script value ${formatLargeNumber(summary.liveStrategyValueUsd)} on 10,000 base`}
                color="oklch(0.72 0.18 155)"
                icon={<DollarSign size={14} />}
              />
              <StatCard
                label="Total P&L"
                value={`${summary.pnlUsd >= 0 ? "+" : ""}${formatLargeNumber(summary.pnlUsd)}`}
                sub={`${formatPct(summary.totalReturnPct)} vs fixed 71,000 USD capital`}
                color={summary.pnlUsd >= 0 ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)"}
                icon={<ArrowUpRight size={14} />}
              />
              <StatCard
                label="Current Signal"
                value={summary.signalAction}
                sub={summary.ruleReason}
                color={assetColor}
                icon={<Zap size={14} />}
              />
              <StatCard
                label="Market Regime"
                value={summary.marketRegime}
                sub={`Confidence ${summary.regimeConfidence} · ${summary.confidenceLabel}`}
                color="oklch(0.60 0.22 255)"
                icon={<Shield size={14} />}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="panel p-5" style={{ borderColor: `${assetColor}20` }}>
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ color: assetColor, opacity: 0.7 }}><DollarSign size={14} /></span>
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
                    Live Position
                  </h2>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold"
                      style={{ background: `${assetColor}15`, border: `1px solid ${assetColor}30`, color: assetColor }}
                    >
                      {ASSET_ICONS[currentAsset] ?? currentAsset[0]}
                    </div>
                    <div>
                      <p className="text-xl font-bold text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                        {currentAsset}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {summary.positionsString} · Hold {summary.holdDays} day{summary.holdDays === 1 ? "" : "s"}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: assetColor }}>
                        {summary.isInCash ? "Portfolio is in cash" : `Entry ${summary.entryDate ?? "—"} @ ${summary.entryPrice ? formatPrice(summary.entryPrice) : "—"}`}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg" style={{ background: "oklch(1 0 0 / 4%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">Invested Value</p>
                      <p className="text-base font-bold mono-data text-white">{formatLargeNumber(summary.displayedInvestedValueUsd)}</p>
                    </div>
                    <div className="p-3 rounded-lg" style={{ background: "oklch(1 0 0 / 4%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">Cash Balance</p>
                      <p className="text-base font-bold mono-data text-white">{formatLargeNumber(summary.displayedCashValueUsd)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">Displayed Units</p>
                      <p className="text-base font-bold mono-data text-white">{summary.displayedUnits > 0 ? summary.displayedUnits.toFixed(6) : "—"}</p>
                    </div>
                    <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">BTC Price / Trigger</p>
                      <p className="text-base font-bold mono-data text-white">
                        {summary.btcPrice ? formatPrice(summary.btcPrice) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={14} className="text-primary opacity-70" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
                    Strategy Snapshot
                  </h2>
                </div>

                <div className="space-y-3">
                  <div className="p-4 rounded-xl border" style={{ background: "oklch(0.60 0.22 255 / 8%)", borderColor: "oklch(0.60 0.22 255 / 18%)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-muted-foreground">Latest Reason</p>
                      <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ fontFamily: "Syne, sans-serif", background: `${assetColor}15`, color: assetColor }}>
                        {summary.signalAction}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80">{summary.ruleReason}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">BTC Drawdown</p>
                      <p className={`text-base font-bold mono-data ${pnlClass(-summary.btcDrawdownPct)}`}>{formatPct(-summary.btcDrawdownPct)}</p>
                    </div>
                    <div className="p-3 rounded-lg border" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <p className="text-xs text-muted-foreground mb-1">Re-entry Gap</p>
                      <p className="text-base font-bold mono-data text-white">
                        {summary.reentryGapPct !== null ? formatPct(summary.reentryGapPct) : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between rounded-lg border p-3" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <span className="text-muted-foreground">Trades Executed</span>
                      <span className="mono-data text-foreground/80">{performance.tradesExecuted}</span>
                    </div>
                    <div className="flex justify-between rounded-lg border p-3" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <span className="text-muted-foreground">Rotations</span>
                      <span className="mono-data text-foreground/80">{performance.rotations}</span>
                    </div>
                    <div className="flex justify-between rounded-lg border p-3" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <span className="text-muted-foreground">Cash Exits</span>
                      <span className="mono-data text-foreground/80">{performance.cashExits}</span>
                    </div>
                    <div className="flex justify-between rounded-lg border p-3" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <span className="text-muted-foreground">Rule 2 Blocks</span>
                      <span className="mono-data text-foreground/80">{performance.rule2Blocks}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <ScoreList title="Momentum Scores" rows={data.rankings.momentumScores} accent="oklch(0.72 0.18 155)" />
              <ScoreList title="Fused Signals" rows={data.rankings.fusedSignals} accent="oklch(0.60 0.22 255)" />
              <ScoreList title="Risk Adjusted Scores" rows={data.rankings.riskAdjustedScores} accent="oklch(0.78 0.18 75)" />
            </div>

            <div className="panel p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 size={14} className="text-primary opacity-70" />
                <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>
                  Droplet Signal History
                </h2>
                <span className="text-xs text-muted-foreground/50 ml-auto">
                  {history.length} record{history.length !== 1 ? "s" : ""} from live JSON history
                </span>
              </div>

              {history.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  <p className="font-semibold">No live history records found</p>
                  <p className="text-xs mt-1 text-muted-foreground/50">
                    Check that optimized_signal_history.json is present and readable on the droplet.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/20">
                        <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Timestamp</th>
                        <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">Action</th>
                        <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">From</th>
                        <th className="text-left py-2 text-muted-foreground/60 font-medium pr-4">To</th>
                        <th className="text-right py-2 text-muted-foreground/60 font-medium pr-4">Confidence</th>
                        <th className="text-left py-2 text-muted-foreground/60 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} className="border-b border-border/10 hover:bg-white/2 transition-colors align-top">
                          <td className="py-2.5 pr-4 mono-data text-muted-foreground/70 whitespace-nowrap">
                            {row.timestamp ? new Date(row.timestamp).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: true, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase" style={{ background: `${assetColor}15`, color: assetColor }}>
                              {row.action}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-foreground/80">{row.currentPosition ?? "CASH"}</td>
                          <td className="py-2.5 pr-4 text-foreground/80">{row.targetPosition ?? "CASH"}</td>
                          <td className="py-2.5 pr-4 text-right mono-data text-foreground/80 font-semibold">
                            {row.confidence !== null ? row.confidence.toFixed(3) : "—"}
                          </td>
                          <td className="py-2.5 text-muted-foreground/70 min-w-[320px]">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <footer className="border-t border-border/20 pt-4 pb-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/40">
                <p>The Financial Revolution · Portfolio mirrored from droplet strategy outputs · Not financial advice</p>
                <p className="mono-data">Source of truth: /root/crypto_dashboard JSON files · Fixed displayed capital 71,000 USD</p>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
