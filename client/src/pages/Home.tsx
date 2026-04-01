import { useEffect, useMemo, useState } from "react";
import { formatLargeNumber, formatPct, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  TrendingUp,
  RefreshCw,
  ShieldAlert,
  Target,
  Activity,
  Clock,
  Database,
  ArrowUpRight,
  Zap,
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
    case "good":    return "oklch(0.72 0.18 155)";
    case "warn":    return "oklch(0.78 0.18 75)";
    case "danger":  return "oklch(0.62 0.22 25)";
    default:        return "oklch(0.60 0.22 255)";
  }
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: color ? `${color}25` : undefined }}>
      <p className="text-xs text-muted-foreground">{label}</p>
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

type DashboardData = {
  liveStrategy?: {
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
    performance?: {
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
  forecast?: {
    nextTrade?: {
      actionIfRunNow?: string;
      targetAsset?: string;
      reason?: string;
      conditionsNeeded?: string[];
    };
    confidence?: { score?: number; label?: string };
  };
  source?: { root?: string; strategy?: string };
  refresh?: { pollingMs?: number; dailyCloseUtc?: string; lastSuccessfulUpdateUtc?: string };
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/live-dashboard", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Dashboard load failed", e);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, (data?.refresh?.pollingMs ?? 5 * 60 * 1000));
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const ls        = data?.liveStrategy;
  const status    = (ls?.status ?? (data as any)?.summary) as any;
  const cashRisk  = ls?.cashRisk;
  const ranking   = ls?.ranking ?? [];
  const prep      = ls?.preparation;
  const planning  = ls?.planning;
  const forecast  = data?.forecast;
  const history   = useMemo(() => Array.isArray(ls?.tradeHistory) ? ls!.tradeHistory! : [], [ls]);

  // Daily close: BTC price recorded at the most recent script run
  const lastDailyClose = useMemo(() => {
    if (history.length === 0) return null;
    const v = Number((history[0] as any).btc_price ?? 0);
    return v > 0 ? v : null;
  }, [history]);
  const lastDailyCloseDate = useMemo(() => {
    if (history.length === 0) return null;
    return String((history[0] as any).date ?? "");
  }, [history]);

  const currentPos    = status?.currentPosition ?? status?.currentAsset ?? "CASH";
  const assetColor    = ASSET_COLORS[currentPos] ?? ASSET_COLORS.CASH;
  const portfolioVal  = status?.displayedPortfolioValueUsd ?? 67428;
  const reserveUsd    = (status as any)?.reserveUsd ?? 0;
  const totalWealthUsd = (status as any)?.totalWealthUsd ?? portfolioVal + reserveUsd;
  const totalWealthReturnPct = (status as any)?.totalWealthReturnPct ?? ((totalWealthUsd - 67428) / 67428 * 100);
  const fixedCap      = status?.fixedCapitalUsd ?? 67428;
  const pnlUsd        = portfolioVal - fixedCap;
  const pnlPct        = fixedCap > 0 ? (pnlUsd / fixedCap) * 100 : 0;
  const pnlColor      = pnlUsd >= 0 ? toneColor("good") : toneColor("danger");
  const regimeConf    = (status as any)?.regimeConf ?? 0;
  const regimeLabel   = (status as any)?.regimeLabel ?? (regimeConf >= 65 ? "Range-Bound" : regimeConf >= 45 ? "Transitioning" : "Trending");
  const regimeTone    = (status as any)?.regimeTone ?? (regimeConf >= 65 ? "warn" : regimeConf >= 45 ? "neutral" : "good");

  const refreshMinutes = Math.round((data?.refresh?.pollingMs ?? 300000) / 60000);
  const cashStatusTone = cashRisk?.statusTone ?? "good";
  const btcDd30Pct     = cashRisk?.btcDd30 != null ? cashRisk.btcDd30 * 100 : null;
  const distanceToCrash = cashRisk?.distanceToCrash ?? null;

  const forecastTarget = forecast?.nextTrade?.targetAsset ?? prep?.targetAsset ?? "";
  const forecastAction = forecast?.nextTrade?.actionIfRunNow ?? status?.signalAction ?? "HOLD";
  const forecastReason = forecast?.nextTrade?.reason ?? status?.ruleReason ?? "—";

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border/30" style={{ background: "oklch(0.13 0.012 260 / 95%)", backdropFilter: "blur(12px)" }}>
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "oklch(0.78 0.18 75 / 15%)", border: "1px solid oklch(0.78 0.18 75 / 25%)" }}>
              <TrendingUp size={18} style={{ color: "oklch(0.78 0.18 75)" }} />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>BULL_ROTATE v2.0</h1>
              <p className="text-xs text-muted-foreground">BTC · ETH · SOL · DOGE · SUI · 30pp threshold · -15% stop · Regime Gate 65% · 10% cash-out</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status?.lastUpdate && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock size={11} />
                <span>{timeAgo(new Date(status.lastUpdate))}</span>
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold" style={{ background: `${assetColor}12`, borderColor: `${assetColor}30`, color: assetColor, fontFamily: "Syne, sans-serif" }}>
              <span>{ASSET_ICONS[currentPos] ?? currentPos}</span>
              <span>{currentPos}</span>
            </div>
          </div>
        </div>
        {/* ── Tab nav ── */}
        <div className="container flex items-center gap-1 pb-0 pt-0 border-t border-border/20">
          <Link href="/portfolio">
            <div className="px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors">My Portfolio</div>
          </Link>
        </div>
      </header>

      <div className="container py-6 space-y-6">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
        ) : !data || !status ? (
          <div className="panel p-6">
            <p className="text-sm text-red-300 font-semibold">Unable to load live dashboard snapshot.</p>
            <p className="text-xs text-muted-foreground mt-2">Please verify that the live dashboard API is responding and the droplet script is running.</p>
          </div>
        ) : (
          <>
            {/* ── Top stat cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Current Position" value={currentPos} sub={status.entryDate ? `Entered ${status.entryDate}` : "Awaiting position"} color={assetColor} />
              <StatCard label="Active Portfolio" value={formatLargeNumber(portfolioVal)} sub={`${pnlUsd >= 0 ? "+" : ""}${formatLargeNumber(pnlUsd)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`} color={pnlColor} />
              <StatCard label="Reserve (Cashed Out)" value={formatLargeNumber(reserveUsd)} sub={reserveUsd > 0 ? "Profit locked in — ready to redeploy" : "No profits cashed out yet"} color="oklch(0.82 0.18 95)" />
              <StatCard label="Total Wealth" value={formatLargeNumber(totalWealthUsd)} sub={`${totalWealthReturnPct >= 0 ? "+" : ""}${totalWealthReturnPct.toFixed(2)}% vs $10,000 start`} color="oklch(0.72 0.18 155)" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Last Signal" value={status.signalAction ?? "HOLD"} sub={status.ruleReason ?? "—"} color="oklch(0.72 0.18 155)" />
              <StatCard label="Hold Days" value={String(status.holdDays ?? 0)} sub={status.lastUpdate ? `Updated ${timeAgo(new Date(status.lastUpdate))}` : "No timestamp"} color="oklch(0.78 0.18 75)" />
              <StatCard label="Last Daily Close" value={lastDailyClose != null ? formatUsd(lastDailyClose) : "—"} sub={lastDailyCloseDate ? `Recorded ${lastDailyCloseDate} at script run` : "Awaiting first run"} color="oklch(0.78 0.18 75)" />
              <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: `${toneColor(regimeTone as any)}25` }}>
                <p className="text-xs text-muted-foreground">BTC Regime</p>
                <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: toneColor(regimeTone as any) }}>{regimeLabel}</p>
                <p className="text-xs text-muted-foreground/60 mono-data">{regimeConf > 0 ? `${regimeConf.toFixed(1)}% range confidence` : "Awaiting data"}</p>
              </div>
              <div className="panel p-4 flex flex-col gap-1" style={{ borderColor: regimeConf >= 65 ? "oklch(0.78 0.18 75 / 25%)" : "oklch(0.72 0.18 155 / 25%)" }}>
                <p className="text-xs text-muted-foreground">Regime Gate</p>
                <p className="text-2xl font-bold mono-data" style={{ fontFamily: "Syne, sans-serif", color: regimeConf >= 65 ? toneColor("warn") : toneColor("good") }}>{regimeConf >= 65 ? "BLOCKING" : "CLEAR"}</p>
                <p className="text-xs text-muted-foreground/60 mono-data">{regimeConf >= 65 ? "Alt rotations blocked — choppy market" : "Alt rotations eligible"}</p>
              </div>
            </div>

            {/* ── Strategy status + refresh ── */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <SectionTitle icon={<Database size={14} className="text-primary opacity-70" />}>What the strategy is doing now</SectionTitle>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div className="space-y-3">
                    <p><span className="text-foreground font-semibold">Holding:</span> {currentPos} — 100% allocation</p>
                    <p><span className="text-foreground font-semibold">Signal:</span> {status.signalAction ?? "HOLD"}</p>
                    <p><span className="text-foreground font-semibold">Reason:</span> {status.ruleReason ?? "—"}</p>
                    <p><span className="text-foreground font-semibold">Entry price:</span> {status.entryPrice ? formatUsd(status.entryPrice) : "—"}</p>
                  </div>
                  <div className="space-y-3">
                    <p><span className="text-foreground font-semibold">Rotation candidate:</span> {forecastTarget || "None above threshold"}</p>
                    <p><span className="text-foreground font-semibold">Rotation status:</span> {prep?.label ?? "Monitoring"}</p>
                    <p><span className="text-foreground font-semibold">Blocker:</span> {planning?.currentBlocker ?? "None"}</p>
                    <p><span className="text-foreground font-semibold">Droplet root:</span> <span className="mono-data break-all">{data.source?.root ?? "/root/crypto_dashboard"}</span></p>
                  </div>
                </div>
              </div>
              <div className="panel p-5">
                <SectionTitle icon={<RefreshCw size={14} className="text-primary opacity-70" />}>Daily refresh</SectionTitle>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-semibold">Strategy:</span> {data.source?.strategy ?? "BULL_ROTATE v2.0"}</p>
                  <p><span className="text-foreground font-semibold">Polling interval:</span> every {refreshMinutes} min</p>
                  <p><span className="text-foreground font-semibold">Daily close:</span> {data.refresh?.dailyCloseUtc ?? "00:05"} UTC</p>
                  <p><span className="text-foreground font-semibold">Last update:</span> {data.refresh?.lastSuccessfulUpdateUtc ? new Date(data.refresh.lastSuccessfulUpdateUtc).toUTCString() : "Unknown"}</p>
                </div>
              </div>
            </div>

            {/* ── Rotation readiness + momentum ranking ── */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <SectionTitle icon={<Target size={14} className="text-primary opacity-70" />}>Rotation readiness</SectionTitle>
                <div className="grid md:grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Leading alt</p>
                    <p className="text-lg font-bold mt-1" style={{ color: ASSET_COLORS[forecastTarget] ?? "white" }}>{forecastTarget || "None"}</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Action if run now</p>
                    <p className="text-lg font-bold mt-1" style={{ color: toneColor(forecastAction === "ROTATE" ? "good" : "warn") }}>{forecastAction}</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Readiness</p>
                    <p className="text-lg font-bold mt-1 text-white">{prep?.label ?? "Monitoring"}</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Rotation rules</p>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p><span className="text-foreground font-semibold">Threshold:</span> Alt composite score must lead BTC by ≥ 30pp</p>
                      <p><span className="text-foreground font-semibold">Min hold:</span> {planning?.rule2Active ? "Active — 3-day hold in progress" : "Clear"}</p>
                      <p><span className="text-foreground font-semibold">Eligible from:</span> {planning?.earliestEligibleRunLabel ?? "Now"}</p>
                      <p><span className="text-foreground font-semibold">Current blocker:</span> {planning?.currentBlocker ?? "None"}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Conditions needed</p>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(forecast?.nextTrade?.conditionsNeeded ?? []).length === 0 ? (
                        <p>No additional conditions — all gates clear.</p>
                      ) : (
                        (forecast?.nextTrade?.conditionsNeeded ?? []).map((c, i) => (
                          <div key={i} className="rounded-lg border px-3 py-2" style={{ borderColor: "oklch(0.72 0.18 155 / 15%)", background: "oklch(0.72 0.18 155 / 5%)" }}>{c}</div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Momentum ranking */}
              <div className="panel p-5">
                <SectionTitle icon={<Activity size={14} className="text-primary opacity-70" />}>Composite momentum ranking</SectionTitle>
                <div className="space-y-2">
                  {ranking.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No ranking data available.</p>
                  ) : ranking.map((row, i) => (
                    <div key={row.asset} className="rounded-xl border px-3 py-2.5" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/50 w-4">{i + 1}</span>
                          <span style={{ color: row.color }}>{row.icon}</span>
                          <span className="font-semibold text-foreground/85">{row.asset}</span>
                        </div>
                        <span className="mono-data font-bold text-sm" style={{ color: row.color }}>{row.score.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground pl-6">
                        <span>30d: {row.mom30 >= 0 ? "+" : ""}{row.mom30.toFixed(1)}%</span>
                        <span>{formatUsd(row.price)}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">Composite = 50% × 30d + 30% × 14d + 20% × 7d momentum. Rotation fires when alt leads BTC by ≥ 30pp.</p>
                </div>
              </div>
            </div>

            {/* ── Cash risk monitor ── */}
            <div className="panel p-5">
              <SectionTitle icon={<ShieldAlert size={14} className="text-primary opacity-70" />}>Cash risk monitor</SectionTitle>
              <div className="grid md:grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Cash status</p>
                  <p className="text-lg font-bold mt-1" style={{ color: toneColor(cashStatusTone) }}>{cashRisk?.statusLabel ?? "—"}</p>
                </div>
                <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">BTC 30d drawdown</p>
                  <p className="text-lg font-bold mt-1" style={{ color: btcDd30Pct != null && btcDd30Pct <= -15 ? toneColor("warn") : "white" }}>
                    {btcDd30Pct != null ? `${btcDd30Pct.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Crash exit at -25%</p>
                </div>
                <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Distance to crash exit</p>
                  <p className="text-lg font-bold mt-1 text-white">
                    {distanceToCrash != null ? `${distanceToCrash.toFixed(1)}pp` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">More drawdown needed to trigger</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                  <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Crash exit rule</p>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p><span className="text-foreground font-semibold">BTC 30d high:</span> {formatUsd(cashRisk?.btc30dHigh ?? 0)}</p>
                    <p><span className="text-foreground font-semibold">Crash exit level (-25%):</span> {formatUsd(cashRisk?.crashExitLevel ?? 0)}</p>
                    <p><span className="text-foreground font-semibold">BTC current price:</span> {formatUsd(cashRisk?.btcPrice ?? 0)}</p>
                    <p><span className="text-foreground font-semibold">Crash active:</span> {cashRisk?.crashActive ? "Yes — in CASH" : "No"}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                  <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Per-position stop loss</p>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p><span className="text-foreground font-semibold">Stop loss level:</span> -15% from entry price</p>
                    <p><span className="text-foreground font-semibold">Entry price:</span> {status?.entryPrice ? formatUsd(status.entryPrice) : "—"}</p>
                    <p><span className="text-foreground font-semibold">Stop price:</span> {cashRisk?.stopLossLevel ? formatUsd(cashRisk.stopLossLevel) : "—"}</p>
                    <p><span className="text-foreground font-semibold">Stop active:</span> {cashRisk?.stopActive ? "Yes — triggered" : "No"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Performance counters ── */}
            <div className="panel p-5">
              <SectionTitle icon={<Zap size={14} className="text-primary opacity-70" />}>Strategy performance counters</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {[
                  { label: "Total Trades",   value: ls?.performance?.counters?.totalTrades ?? 0 },
                  { label: "Rotations",      value: ls?.performance?.counters?.rotations ?? 0 },
                  { label: "Crash Exits",    value: ls?.performance?.counters?.crashExits ?? 0 },
                  { label: "Stop Fires",     value: ls?.performance?.counters?.stopFires ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border p-3 text-center" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold mono-data mt-1 text-white" style={{ fontFamily: "Syne, sans-serif" }}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Days in Cash",      value: ls?.performance?.counters?.cashDays ?? 0, color: undefined },
                  { label: "Regime Blocks",     value: (ls?.performance?.counters as any)?.regimeBlocks ?? 0, color: "oklch(0.78 0.18 75)" },
                  { label: "Cash-Out Events",   value: (ls?.performance?.counters as any)?.cashoutFires ?? 0, color: "oklch(0.82 0.18 95)" },
                  { label: "Total Cashed Out",  value: formatLargeNumber((ls?.performance?.counters as any)?.totalCashedOut ?? 0), color: "oklch(0.72 0.18 155)" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl border p-3 text-center" style={{ background: "oklch(1 0 0 / 2%)", borderColor: color ? `${color}20` : "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold mono-data mt-1" style={{ fontFamily: "Syne, sans-serif", color: color ?? "white" }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Trade history ── */}
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4 gap-4">
                <div>
                  <h2 className="text-sm font-bold tracking-wide text-white" style={{ fontFamily: "Syne, sans-serif" }}>Recent Trade History</h2>
                  <p className="text-xs text-muted-foreground mt-1">Latest records from the droplet — updated daily at 00:05 UTC.</p>
                </div>
                <p className="text-xs text-muted-foreground mono-data">{history.length} records</p>
              </div>
              <div className="space-y-2">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No trade history available yet.</p>
                ) : history.slice(0, 15).map((row, i) => {
                  const pos      = String((row as any).position ?? (row as any).current_position ?? "—");
                  const act      = String((row as any).action ?? "—");
                  const reason   = String((row as any).reason ?? "—");
                  const date     = String((row as any).date ?? (row as any).timestamp ?? `Record ${i + 1}`);
                  const val      = Number((row as any).portfolio_value ?? (row as any).portfolioValue ?? 0);
                  const btcClose = Number((row as any).btc_price ?? 0);
                  const posColor = ASSET_COLORS[pos] ?? "white";
                  return (
                    <div key={i} className="rounded-xl border border-border/20 p-3 bg-card/20">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold mono-data text-muted-foreground">{date}</span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: `${posColor}15`, color: posColor }}>{pos}</span>
                          <span className="text-xs text-muted-foreground">{act}</span>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          {btcClose > 0 && <span className="text-xs mono-data font-semibold" style={{ color: "oklch(0.78 0.18 75)" }}>₿ {formatUsd(btcClose)}</span>}
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
