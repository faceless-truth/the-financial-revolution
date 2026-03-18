from pathlib import Path
import re

ROOT = Path('/home/ubuntu/the-financial-revolution-work')

live_ts = ROOT / 'server' / 'livePortfolio.ts'
live_router_ts = ROOT / 'server' / 'livePortfolioRouter.ts'
routers_ts = ROOT / 'server' / 'routers.ts'
server_index_ts = ROOT / 'server' / 'index.ts'
portfolio_tsx = ROOT / 'client' / 'src' / 'pages' / 'Portfolio.tsx'
home_tsx = ROOT / 'client' / 'src' / 'pages' / 'Home.tsx'

live_ts.write_text('''import fs from "fs/promises";
import path from "path";

const DASHBOARD_ROOT = process.env.CRYPTO_DASHBOARD_ROOT ?? "/var/lib/crypto_dashboard";
const STATE_FILE = process.env.CRYPTO_DASHBOARD_STATE_FILE ?? path.join(DASHBOARD_ROOT, "optimized_trading_state.json");
const STRATEGY_FILE = process.env.CRYPTO_DASHBOARD_STRATEGY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_strategy_data.json");
const SIGNAL_HISTORY_FILE = process.env.CRYPTO_DASHBOARD_SIGNAL_HISTORY_FILE ?? path.join(DASHBOARD_ROOT, "optimized_signal_history.json");
const ANALYTICS_FILE = process.env.CRYPTO_DASHBOARD_ANALYTICS_FILE ?? path.join(DASHBOARD_ROOT, "paleologo_analytics.json");
const SCENARIO_FILE = process.env.CRYPTO_DASHBOARD_SCENARIO_FILE ?? path.join(DASHBOARD_ROOT, "next_scenarios.json");

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function inferDisplayedPortfolioValueUsd(state: any, analytics: any, strategy: any): number {
  return toNumber(
    state?.displayedPortfolioValueUsd ??
    state?.portfolio_value_usd ??
    analytics?.displayedPortfolioValueUsd ??
    analytics?.portfolio_value_usd ??
    strategy?.displayedPortfolioValueUsd ??
    71000,
    71000,
  );
}

function inferFixedCapitalUsd(state: any, analytics: any, strategy: any): number {
  return toNumber(
    state?.fixedCapitalUsd ??
    state?.fixed_capital_usd ??
    analytics?.fixedCapitalUsd ??
    strategy?.fixedCapitalUsd ??
    71000,
    71000,
  );
}

function inferLastUpdate(state: any, history: any[]): string {
  const lastHistory = history.length ? history[history.length - 1] : null;
  return asString(
    state?.last_update ??
    state?.lastUpdate ??
    lastHistory?.timestamp ??
    lastHistory?.date ??
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

export async function getLivePortfolioData() {
  const [state, strategy, history, analytics, scenarios] = await Promise.all([
    readJson<any>(STATE_FILE, {}),
    readJson<any>(STRATEGY_FILE, {}),
    readJson<any[]>(SIGNAL_HISTORY_FILE, []),
    readJson<any>(ANALYTICS_FILE, {}),
    readJson<any>(SCENARIO_FILE, {}),
  ]);

  const displayedPortfolioValueUsd = inferDisplayedPortfolioValueUsd(state, analytics, strategy);
  const fixedCapitalUsd = inferFixedCapitalUsd(state, analytics, strategy);
  const pnlUsd = displayedPortfolioValueUsd - fixedCapitalUsd;
  const totalReturnPct = fixedCapitalUsd > 0 ? (pnlUsd / fixedCapitalUsd) * 100 : 0;
  const lastUpdate = inferLastUpdate(state, history);
  const currentAsset = asString(state?.current_asset ?? state?.currentPosition ?? state?.current_position ?? "CASH", "CASH");
  const signalAction = asString(state?.signal_action ?? state?.signalAction ?? strategy?.signalAction ?? strategy?.action ?? "HOLD", "HOLD");
  const marketRegime = asString(strategy?.marketRegime ?? strategy?.market_regime ?? analytics?.marketRegime ?? "LIVE", "LIVE");
  const ruleReason = asString(state?.reason ?? state?.rule_reason ?? strategy?.reason ?? "Live droplet mirror", "Live droplet mirror");
  const regimeConfidence = asString(strategy?.regimeConfidence ?? strategy?.confidence ?? analytics?.confidenceLabel ?? "—", "—");
  const confidenceLabel = asString(strategy?.confidenceLabel ?? analytics?.confidenceLabel ?? "Live", "Live");
  const liveStrategyValueUsd = toNumber(state?.liveStrategyValueUsd ?? state?.live_strategy_value_usd ?? analytics?.liveStrategyValueUsd ?? displayedPortfolioValueUsd, displayedPortfolioValueUsd);
  const holdDays = toNumber(state?.hold_days ?? state?.holdDays ?? 0, 0);
  const entryPrice = toNumber(state?.entry_price ?? state?.entryPrice ?? 0, 0);
  const entryDate = asString(state?.entry_date ?? state?.entryDate ?? "", "");
  const topCandidates = Array.isArray(strategy?.topCandidates)
    ? strategy.topCandidates
    : Array.isArray(strategy?.momentumRanked)
      ? strategy.momentumRanked
      : [];

  return {
    source: {
      root: DASHBOARD_ROOT,
      files: {
        state: STATE_FILE,
        strategy: STRATEGY_FILE,
        signalHistory: SIGNAL_HISTORY_FILE,
        analytics: ANALYTICS_FILE,
        scenarios: SCENARIO_FILE,
      },
    },
    summary: {
      fixedCapitalUsd,
      displayedPortfolioValueUsd,
      liveStrategyValueUsd,
      pnlUsd,
      totalReturnPct,
      currentAsset,
      signalAction,
      ruleReason,
      marketRegime,
      regimeConfidence,
      confidenceLabel,
      lastUpdate,
      holdDays,
      entryPrice,
      entryDate,
    },
    performance: {
      btcHoldValueUsd: toNumber(analytics?.btcHoldValueUsd ?? analytics?.btc_hold_value_usd ?? 0, 0),
      outperformanceUsd: toNumber(analytics?.outperformanceUsd ?? analytics?.outperformance_usd ?? 0, 0),
      outperformancePct: toNumber(analytics?.outperformancePct ?? analytics?.outperformance_pct ?? 0, 0),
      unrealisedPnlUsd: toNumber(state?.unrealisedPnlUsd ?? state?.unrealised_pnl_usd ?? 0, 0),
      unrealisedPnlPct: toNumber(state?.unrealisedPnlPct ?? state?.unrealised_pnl_pct ?? 0, 0),
    },
    preparation: {
      readiness: asString(strategy?.readiness ?? strategy?.preparation?.readiness ?? "WATCH", "WATCH"),
      label: asString(strategy?.preparation?.label ?? strategy?.readiness ?? "Watch", "Watch"),
      note: asString(strategy?.preparation?.note ?? strategy?.reason ?? ruleReason, ruleReason),
      targetAsset: asString(strategy?.topAsset ?? strategy?.targetAsset ?? "", ""),
      topCandidates,
      scenario: scenarios ?? {},
    },
    tradeHistory: Array.isArray(history) ? history.slice(-50).reverse() : [],
    raw: {
      state,
      strategy,
      analytics,
      scenarios,
    },
  };
}

export async function getLiveDashboardData() {
  const snapshot = await getLivePortfolioData();
  const topCandidates = Array.isArray(snapshot.preparation.topCandidates) ? snapshot.preparation.topCandidates : [];
  return {
    status: {
      currentPosition: snapshot.summary.currentAsset,
      signalAction: snapshot.summary.signalAction,
      holdDays: snapshot.summary.holdDays,
      entryPrice: snapshot.summary.entryPrice,
      entryDate: snapshot.summary.entryDate,
      lastUpdate: snapshot.summary.lastUpdate,
      ruleReason: snapshot.summary.ruleReason,
      displayedPortfolioValueUsd: snapshot.summary.displayedPortfolioValueUsd,
      fixedCapitalUsd: snapshot.summary.fixedCapitalUsd,
    },
    ranking: topCandidates,
    preparation: snapshot.preparation,
    tradeHistory: snapshot.tradeHistory,
    source: snapshot.source,
  };
}
''')

live_router_ts.write_text('''import { router, publicProcedure } from "./_core/trpc";
import { getLivePortfolioData, getLiveDashboardData } from "./livePortfolio";

export const livePortfolioRouter = router({
  getSnapshot: publicProcedure.query(async () => {
    return getLivePortfolioData();
  }),
  getDashboard: publicProcedure.query(async () => {
    return getLiveDashboardData();
  }),
});
''')

routers_text = routers_ts.read_text()
if 'livePortfolioRouter' not in routers_text:
  routers_text = routers_text.replace(
    'import { passwordRouter } from "./passwordRouter";\n',
    'import { passwordRouter } from "./passwordRouter";\nimport { livePortfolioRouter } from "./livePortfolioRouter";\n'
  )
  routers_text = routers_text.replace(
    '  password: passwordRouter,\n',
    '  password: passwordRouter,\n  livePortfolio: livePortfolioRouter,\n'
  )
routers_ts.write_text(routers_text)

server_index_ts.write_text('''import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getLivePortfolioData, getLiveDashboardData } from "./livePortfolio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.get("/api/live-portfolio", async (_req, res) => {
    try {
      const data = await getLivePortfolioData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live portfolio snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/live-dashboard", async (_req, res) => {
    try {
      const data = await getLiveDashboardData();
      res.json(data);
    } catch (error) {
      res.status(500).json({
        error: "Unable to load live dashboard snapshot",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
''')

portfolio_tsx.write_text('''import { useEffect, useMemo, useState } from "react";
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
                    <BellRing size={14} style={{ color: prep.color, opacity: 0.8 }} />
                    <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Source of Truth</h2>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>Source of truth: live droplet JSON data · Fixed displayed capital 71,000 USD</p>
                    <p className="mono-data break-all">{data.source?.root ?? "/var/lib/crypto_dashboard"}</p>
                    <p>Public dashboard now reflects the live script state rather than local browser-only calculations.</p>
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
''')

home_tsx.write_text('''import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatLargeNumber, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Clock, Activity, Shield, BellRing, ArrowUpRight } from "lucide-react";

const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.70 0.15 290)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.65 0.20 220)",
  DOGE: "oklch(0.78 0.18 75)",
  CASH: "oklch(0.55 0.010 260)",
};

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "◈", DOGE: "Ð", CASH: "$",
};

type LiveDashboardSnapshot = {
  status?: {
    currentPosition?: string;
    signalAction?: string;
    holdDays?: number;
    entryPrice?: number;
    entryDate?: string;
    lastUpdate?: string;
    ruleReason?: string;
    displayedPortfolioValueUsd?: number;
    fixedCapitalUsd?: number;
  };
  ranking?: Array<{ asset?: string; symbol?: string; score?: number }>;
  preparation?: {
    readiness?: string;
    note?: string;
    targetAsset?: string;
  };
  tradeHistory?: Array<Record<string, unknown>>;
  source?: { root?: string };
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: color ? `${color}25` : undefined }}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: color ?? "white" }}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<LiveDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadSnapshot() {
      try {
        const response = await fetch('/api/live-dashboard', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!cancelled) setData(json);
      } catch (error) {
        console.error('Failed to load live dashboard', error);
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

  const status = data?.status;
  const ranking = useMemo(() => Array.isArray(data?.ranking) ? data!.ranking! : [], [data]);
  const history = useMemo(() => Array.isArray(data?.tradeHistory) ? data!.tradeHistory! : [], [data]);
  const currentAsset = status?.currentPosition ?? 'CASH';
  const assetColor = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;

  return (
    <div className="min-h-screen" style={{ background: 'oklch(0.10 0.010 260)' }}>
      <header className="sticky top-0 z-50 border-b border-border/30" style={{ background: 'oklch(0.13 0.012 260 / 95%)', backdropFilter: 'blur(12px)' }}>
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'oklch(0.72 0.18 155 / 15%)', border: '1px solid oklch(0.72 0.18 155 / 25%)' }}>
              <TrendingUp size={16} style={{ color: 'oklch(0.72 0.18 155)' }} />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white" style={{ fontFamily: 'Syne, sans-serif' }}>The Financial Revolution</h1>
              <p className="text-xs text-muted-foreground">Strategy Dashboard</p>
            </div>
          </div>
          <Link href="/portfolio">
            <div className="px-3 py-1.5 rounded-lg border text-sm font-bold cursor-pointer" style={{ borderColor: `${assetColor}30`, color: assetColor, fontFamily: 'Syne, sans-serif' }}>
              {ASSET_ICONS[currentAsset] ?? currentAsset} {currentAsset}
            </div>
          </Link>
        </div>
      </header>

      <div className="container py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !data || !status ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live dashboard snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please verify that the live dashboard API is responding.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Current Position" value={status.currentPosition ?? 'CASH'} sub={status.entryDate ? `Entered ${status.entryDate}` : 'Awaiting position'} color={assetColor} />
              <StatCard label="Signal Action" value={status.signalAction ?? 'HOLD'} sub={status.ruleReason ?? 'Live droplet mirror'} color="oklch(0.72 0.18 155)" />
              <StatCard label="Displayed Value" value={formatLargeNumber(status.displayedPortfolioValueUsd ?? 0)} sub={`Fixed capital ${formatLargeNumber(status.fixedCapitalUsd ?? 71_000)}`} color="oklch(0.60 0.22 255)" />
              <StatCard label="Hold Days" value={String(status.holdDays ?? 0)} sub={status.lastUpdate ? `Updated ${timeAgo(new Date(status.lastUpdate))}` : 'No timestamp'} color="oklch(0.78 0.18 75)" />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <div className="flex items-center gap-2 mb-4">
                  <Activity size={14} className="text-primary opacity-70" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: 'Geist, sans-serif' }}>Live Strategy Status</h2>
                </div>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-semibold">Rule reason:</span> {status.ruleReason ?? '—'}</p>
                  <p><span className="text-foreground font-semibold">Preparation:</span> {data.preparation?.readiness ?? 'WATCH'}{data.preparation?.targetAsset ? ` · target ${data.preparation.targetAsset}` : ''}</p>
                  <p><span className="text-foreground font-semibold">Source:</span> <span className="mono-data break-all">{data.source?.root ?? '/var/lib/crypto_dashboard'}</span></p>
                </div>
              </div>
              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Shield size={14} className="text-primary opacity-70" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: 'Geist, sans-serif' }}>What to Expect</h2>
                </div>
                <p className="text-sm text-muted-foreground">The dashboard now reflects the live droplet script state, including current position, hold-day progression, and most recent rule reasoning.</p>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-4">
                  <ArrowUpRight size={14} className="text-primary opacity-70" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: 'Geist, sans-serif' }}>Momentum Ranking</h2>
                </div>
                <div className="space-y-2">
                  {ranking.length === 0 ? <p className="text-sm text-muted-foreground">No ranking data available.</p> : ranking.slice(0, 5).map((row, index) => {
                    const asset = row.asset ?? row.symbol ?? '—';
                    const score = Number(row.score ?? 0);
                    return (
                      <div key={`${asset}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ background: 'oklch(1 0 0 / 3%)', borderColor: 'oklch(1 0 0 / 8%)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/50 w-4">{index + 1}</span>
                          <span style={{ color: ASSET_COLORS[asset] ?? assetColor }}>{ASSET_ICONS[asset] ?? asset[0]}</span>
                          <span className="font-semibold text-foreground/85">{asset}</span>
                        </div>
                        <span className="mono-data font-bold" style={{ color: ASSET_COLORS[asset] ?? assetColor }}>{score.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BellRing size={14} className="text-primary opacity-70" />
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: 'Geist, sans-serif' }}>Recent Signal History</h2>
                </div>
                <div className="space-y-3">
                  {history.length === 0 ? <p className="text-sm text-muted-foreground">No history available.</p> : history.slice(0, 5).map((row, index) => (
                    <div key={`dash-hist-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <p className="text-sm font-semibold text-foreground mono-data">{String((row as any).timestamp ?? (row as any).date ?? `Record ${index + 1}`)}</p>
                        <p className="text-xs text-muted-foreground">{String((row as any).action ?? (row as any).signalAction ?? (row as any).ruleTriggered ?? '—')}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{String((row as any).reason ?? (row as any).notes ?? (row as any).ruleReason ?? 'No reason supplied')}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-center text-xs text-muted-foreground pt-2 border-t border-border/20">
              <p>{status.lastUpdate ? `Last updated: ${new Date(status.lastUpdate).toUTCString()}` : 'Fetching live data...'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
''')

print('Patched live server and client files for droplet-backed dashboard/portfolio sync.')
