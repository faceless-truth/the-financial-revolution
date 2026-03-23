import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { formatLargeNumber, timeAgo } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Clock, ArrowUpRight, Radar, CalendarDays, Database, RefreshCw, ShieldAlert, Target } from "lucide-react";

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

type RankingRow = { asset?: string; symbol?: string; score?: number };

type LiveStrategyStatus = {
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

type LiveDashboardSnapshot = {
  liveStrategy?: {
    status?: LiveStrategyStatus;
    ranking?: RankingRow[];
    preparation?: {
      readiness?: string;
      note?: string;
      targetAsset?: string;
    };
    planning?: {
      currentBlocker?: string;
      candidateAsset?: string;
      earliestEligibleRunLabel?: string;
      earliestEligibleRunUtc?: string;
      latestThirtyDayHighDateUtc?: string;
      blockExpiresAfterCloseUtc?: string;
      rule2Active?: boolean;
      rule3Active?: boolean;
      rule4Ready?: boolean | null;
      nextActionSummary?: string;
      holdDays?: number;
      currentAsset?: string;
    };
    performance?: {
      counters?: {
        trades?: number;
        rotations?: number;
        cashExits?: number;
        allNegativeExits?: number;
        allNegativeBlocked?: number;
        rule2Blocks?: number;
        rule3Blocks?: number;
        rule3ForceBtc?: number;
        rule4Blocks?: number;
      };
    };
    tradeHistory?: Array<Record<string, unknown>>;
  };
  forecast?: {
    generatedAtUtc?: string;
    sourceMode?: string;
    currentPosition?: {
      asset?: string;
      allocation?: number;
      holdDays?: number;
      entryPrice?: number;
      entryDate?: string;
      portfolioValueUsd?: number;
    };
    momentumRanking?: RankingRow[];
    btcHealth?: {
      latestThirtyDayHighDateUtc?: string;
      blockExpiresAfterCloseUtc?: string;
      rule3Active?: boolean;
    };
    confidence?: {
      score?: number;
      label?: string;
      fearGreedValue?: number;
      fearGreedAverage?: number;
    };
    rules?: {
      rule2Active?: boolean;
      rule3Active?: boolean;
      rule4Ready?: boolean | null;
      currentBlocker?: string;
    };
    nextTrade?: {
      actionIfRunNow?: string;
      targetAsset?: string;
      reason?: string;
      conditionsNeeded?: string[];
    };
    forwardOutlook?: Array<{
      day?: number;
      dateUtc?: string;
      label?: string;
      notes?: string[];
    }>;
  };
  source?: { root?: string };
  refresh?: {
    pollingMs?: number;
    dailyCloseUtc?: string;
    lastSuccessfulUpdateUtc?: string;
  };
  legacy?: {
    status?: LiveStrategyStatus;
    ranking?: RankingRow[];
    planning?: LiveDashboardSnapshot["liveStrategy"]["planning"];
    preparation?: LiveDashboardSnapshot["liveStrategy"]["preparation"];
    tradeHistory?: Array<Record<string, unknown>>;
  };
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

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>{children}</h2>
    </div>
  );
}

function toneColor(kind: "good" | "warn" | "neutral") {
  if (kind === "good") return "oklch(0.72 0.18 155)";
  if (kind === "warn") return "oklch(0.78 0.18 75)";
  return "oklch(0.72 0.02 260)";
}

function counterValue(value: unknown) {
  return Number.isFinite(Number(value)) ? String(value) : "0";
}

function formatUsd(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
}

function extractLatestHistory(history: Array<Record<string, unknown>>) {
  return Array.isArray(history) && history.length > 0 ? history[0] : undefined;
}

function extractBtcThirtyDayHigh(latestHistory?: Record<string, unknown>) {
  const value = Number(latestHistory?.btc_30d_high ?? latestHistory?.btc30dHigh ?? NaN);
  return Number.isFinite(value) ? value : null;
}

function extractBtcDrawdownPct(latestHistory?: Record<string, unknown>) {
  const raw = Number(latestHistory?.btc_drawdown ?? latestHistory?.btcDrawdown ?? NaN);
  if (!Number.isFinite(raw)) return null;
  return Math.abs(raw) <= 1 ? Math.abs(raw) * 100 : Math.abs(raw);
}

export default function Home() {
  const [data, setData] = useState<LiveDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadSnapshot() {
      try {
        const response = await fetch("/api/live-dashboard", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        if (!cancelled) setData(json);
      } catch (error) {
        console.error("Failed to load live dashboard", error);
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

  const liveStrategy = data?.liveStrategy;
  const legacy = data?.legacy;
  const status = liveStrategy?.status ?? legacy?.status;
  const planning = liveStrategy?.planning ?? legacy?.planning ?? {};
  const ranking = useMemo(() => {
    const primary = Array.isArray(liveStrategy?.ranking) ? liveStrategy?.ranking : [];
    const fallback = Array.isArray(legacy?.ranking) ? legacy?.ranking : [];
    return primary.length > 0 ? primary : fallback;
  }, [liveStrategy, legacy]);
  const history = useMemo(() => {
    const primary = Array.isArray(liveStrategy?.tradeHistory) ? liveStrategy?.tradeHistory : [];
    const fallback = Array.isArray(legacy?.tradeHistory) ? legacy?.tradeHistory : [];
    return primary.length > 0 ? primary : fallback;
  }, [liveStrategy, legacy]);
  const forecast = data?.forecast;
  const forecastRanking = Array.isArray(forecast?.momentumRanking) && forecast?.momentumRanking.length > 0 ? forecast.momentumRanking : ranking;
  const currentAsset = status?.currentPosition ?? forecast?.currentPosition?.asset ?? "CASH";
  const assetColor = ASSET_COLORS[currentAsset] ?? ASSET_COLORS.CASH;
  const liveTarget = planning.candidateAsset ?? liveStrategy?.preparation?.targetAsset ?? legacy?.preparation?.targetAsset ?? ranking[0]?.asset ?? ranking[0]?.symbol ?? "—";
  const refreshMinutes = Math.round((data?.refresh?.pollingMs ?? 5 * 60 * 1000) / 60000);
  const forwardOutlook = Array.isArray(forecast?.forwardOutlook) ? forecast.forwardOutlook.slice(0, 3) : [];
  const latestHistory = extractLatestHistory(history);
  const btcThirtyDayHigh = extractBtcThirtyDayHigh(latestHistory);
  const btcDrawdownPct = extractBtcDrawdownPct(latestHistory);
  const warningClose = btcThirtyDayHigh ? btcThirtyDayHigh * 0.88 : null;
  const hardExitClose = btcThirtyDayHigh ? btcThirtyDayHigh * 0.75 : null;
  const drawdownToWarning = btcDrawdownPct == null ? null : Math.max(0, 12 - btcDrawdownPct);
  const drawdownToHardExit = btcDrawdownPct == null ? null : Math.max(0, 25 - btcDrawdownPct);
  const rule3AllNegative = latestHistory?.all_negative === true;
  const rule1WarningActive = btcDrawdownPct != null && btcDrawdownPct >= 12;
  const rule1HardExitActive = btcDrawdownPct != null && btcDrawdownPct >= 25;
  const cashStatusLabel = rule1HardExitActive
    ? "100% cash trigger active"
    : rule1WarningActive
      ? "50% allocation trigger active"
      : rule3AllNegative
        ? "Rule 3 cash exit condition active"
        : "No cash trigger active";
  const cashStatusTone = rule1HardExitActive || rule3AllNegative || rule1WarningActive ? "warn" : "good";
  const forecastReason = forecast?.nextTrade?.reason ?? "No separate forecast payload available.";
  const forecastAction = forecast?.nextTrade?.actionIfRunNow ?? status?.signalAction ?? "HOLD";
  const forecastTarget = forecast?.nextTrade?.targetAsset ?? liveTarget;

  return (
    <div className="min-h-screen" style={{ background: "oklch(0.10 0.010 260)" }}>
      <header className="sticky top-0 z-50 border-b border-border/30" style={{ background: "oklch(0.13 0.012 260 / 95%)", backdropFilter: "blur(12px)" }}>
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.72 0.18 155 / 15%)", border: "1px solid oklch(0.72 0.18 155 / 25%)" }}>
              <TrendingUp size={16} style={{ color: "oklch(0.72 0.18 155)" }} />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>The Financial Revolution</h1>
              <p className="text-xs text-muted-foreground">Dual-Engine Strategy Dashboard</p>
            </div>
          </div>
          <Link href="/portfolio">
            <div className="px-3 py-1.5 rounded-lg border text-sm font-bold cursor-pointer" style={{ borderColor: `${assetColor}30`, color: assetColor, fontFamily: "Syne, sans-serif" }}>
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
              <StatCard label="Current Position" value={status.currentPosition ?? "CASH"} sub={status.entryDate ? `Entered ${status.entryDate}` : "Awaiting position"} color={assetColor} />
              <StatCard label="Executed Signal" value={status.signalAction ?? "HOLD"} sub={status.ruleReason ?? "—"} color="oklch(0.72 0.18 155)" />
              <StatCard label="Displayed Value" value={formatLargeNumber(status.displayedPortfolioValueUsd ?? 0)} sub={`Fixed capital ${formatLargeNumber(status.fixedCapitalUsd ?? 71_000)}`} color="oklch(0.60 0.22 255)" />
              <StatCard label="Hold Days" value={String(status.holdDays ?? forecast?.currentPosition?.holdDays ?? 0)} sub={status.lastUpdate ? `Updated ${timeAgo(new Date(status.lastUpdate))}` : "No timestamp"} color="oklch(0.78 0.18 75)" />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <SectionTitle icon={<Database size={14} className="text-primary opacity-70" />}>What the strategy is doing now</SectionTitle>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div className="space-y-3">
                    <p><span className="text-foreground font-semibold">Allocation now:</span> {status.currentPosition ?? "CASH"} 100%</p>
                    <p><span className="text-foreground font-semibold">Action:</span> {status.signalAction ?? "HOLD"}</p>
                    <p><span className="text-foreground font-semibold">Primary reason:</span> {status.ruleReason ?? "—"}</p>
                  </div>
                  <div className="space-y-3">
                    <p><span className="text-foreground font-semibold">Leading asset:</span> {forecastTarget}</p>
                    <p><span className="text-foreground font-semibold">Why no rotation yet:</span> {forecastReason}</p>
                    <p><span className="text-foreground font-semibold">Source:</span> <span className="mono-data break-all">{data.source?.root ?? "/var/lib/crypto_dashboard"}</span></p>
                  </div>
                </div>
              </div>
              <div className="panel p-5">
                <SectionTitle icon={<RefreshCw size={14} className="text-primary opacity-70" />}>Daily refresh</SectionTitle>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-semibold">Polling interval:</span> every {refreshMinutes} min</p>
                  <p><span className="text-foreground font-semibold">Daily strategy close:</span> {data.refresh?.dailyCloseUtc ?? "00:05"} UTC</p>
                  <p><span className="text-foreground font-semibold">Last successful update:</span> {data.refresh?.lastSuccessfulUpdateUtc ? new Date(data.refresh.lastSuccessfulUpdateUtc).toUTCString() : "Unknown"}</p>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <SectionTitle icon={<Target size={14} className="text-primary opacity-70" />}>What is trying to happen next</SectionTitle>
                <div className="grid md:grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Leader</p>
                    <p className="text-lg font-bold mt-1" style={{ color: ASSET_COLORS[String(forecastTarget)] ?? "white" }}>{forecastTarget}</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Action if run now</p>
                    <p className="text-lg font-bold mt-1" style={{ color: toneColor(forecastAction === "BUY" ? "good" : "warn") }}>{forecastAction}</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Confidence</p>
                    <p className="text-lg font-bold mt-1 text-white">{typeof forecast?.confidence?.score === "number" ? forecast.confidence.score.toFixed(3) : "—"}</p>
                    <p className="text-xs text-muted-foreground mt-2">{forecast?.confidence?.label ?? "Unknown"}</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Forecast reason</p>
                    <p className="text-sm text-muted-foreground">{forecastReason}</p>
                    <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                      <p><span className="text-foreground font-semibold">Rule 2:</span> {forecast?.rules?.rule2Active ? "Active" : "Clear"}</p>
                      <p><span className="text-foreground font-semibold">Rule 3:</span> {forecast?.rules?.rule3Active ? "Active" : "Clear"}</p>
                      <p><span className="text-foreground font-semibold">Rule 4:</span> {forecast?.rules?.rule4Ready === false ? "Blocking" : forecast?.rules?.rule4Ready === true ? "Ready" : "Monitoring"}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Conditions needed</p>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {(forecast?.nextTrade?.conditionsNeeded ?? []).length === 0 ? (
                        <p>No additional forecast conditions supplied.</p>
                      ) : (
                        (forecast?.nextTrade?.conditionsNeeded ?? []).map((condition, index) => (
                          <div key={`condition-${index}`} className="rounded-lg border px-3 py-2" style={{ borderColor: "oklch(0.72 0.18 155 / 15%)", background: "oklch(0.72 0.18 155 / 5%)" }}>{condition}</div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="panel p-5">
                <SectionTitle icon={<CalendarDays size={14} className="text-primary opacity-70" />}>Short outlook</SectionTitle>
                <div className="space-y-3">
                  {forwardOutlook.length === 0 ? <p className="text-sm text-muted-foreground">No short outlook available.</p> : forwardOutlook.map((item, index) => (
                    <div key={`outlook-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <p className="text-sm font-semibold text-foreground">+{item.day ?? index + 1}d</p>
                        <p className="text-xs text-muted-foreground mono-data">{item.label ?? item.dateUtc ?? `Day ${index + 1}`}</p>
                      </div>
                      <div className="space-y-1">
                        {(item.notes ?? []).map((note, noteIndex) => <p key={`note-${index}-${noteIndex}`} className="text-xs text-muted-foreground">{note}</p>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="panel p-5 lg:col-span-2">
                <SectionTitle icon={<ShieldAlert size={14} className="text-primary opacity-70" />}>Cash risk monitor</SectionTitle>
                <div className="grid md:grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Cash status</p>
                    <p className="text-lg font-bold mt-1" style={{ color: toneColor(cashStatusTone) }}>{cashStatusLabel}</p>
                    <p className="text-xs text-muted-foreground mt-2">Based on Rule 1 BTC drawdown and Rule 3 all-negative exit only.</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">BTC 30d high</p>
                    <p className="text-lg font-bold mt-1 text-white">{formatUsd(btcThirtyDayHigh)}</p>
                    <p className="text-xs text-muted-foreground mt-2">Reference level for Rule 1 close triggers.</p>
                  </div>
                  <div className="rounded-xl border p-3" style={{ background: "oklch(1 0 0 / 2%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Current BTC drawdown</p>
                    <p className="text-lg font-bold mt-1 text-white">{btcDrawdownPct == null ? "—" : `${btcDrawdownPct.toFixed(1)}%`}</p>
                    <p className="text-xs text-muted-foreground mt-2">Current distance below the 30-day high.</p>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Rule 1 close triggers</p>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p><span className="text-foreground font-semibold">50% allocation trigger:</span> BTC daily close at or below <span className="mono-data text-foreground">{formatUsd(warningClose)}</span></p>
                      <p><span className="text-foreground font-semibold">100% cash trigger:</span> BTC daily close at or below <span className="mono-data text-foreground">{formatUsd(hardExitClose)}</span></p>
                      <p><span className="text-foreground font-semibold">Distance to 50% trigger:</span> {drawdownToWarning == null ? "—" : `${drawdownToWarning.toFixed(1)}% more drawdown needed`}</p>
                      <p><span className="text-foreground font-semibold">Distance to 100% trigger:</span> {drawdownToHardExit == null ? "—" : `${drawdownToHardExit.toFixed(1)}% more drawdown needed`}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/20 p-4 bg-card/20">
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">Rule 3 cash exit</p>
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <p><span className="text-foreground font-semibold">All assets negative now:</span> {rule3AllNegative ? "Yes" : "No"}</p>
                      <p><span className="text-foreground font-semibold">7-day hold passed:</span> {(status.holdDays ?? 0) >= 7 ? "Yes" : "No"}</p>
                      <p><span className="text-foreground font-semibold">Rule 3 exit active:</span> {rule3AllNegative && (status.holdDays ?? 0) >= 7 ? "Yes" : "No"}</p>
                      <p><span className="text-foreground font-semibold">Re-entry condition:</span> BTC 30-day momentum must turn positive.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/20 p-4 bg-card/20 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-semibold">Read this section as preparation guidance:</span> if BTC closes below the Rule 1 levels above, the cash defense becomes active on the strategy rules you provided. If all five assets are negative after the 7-day hold window, Rule 3 forces 100% cash.</p>
                </div>
              </div>
              <div className="panel p-5">
                <SectionTitle icon={<ArrowUpRight size={14} className="text-primary opacity-70" />}>Momentum ranking</SectionTitle>
                <div className="space-y-2">
                  {forecastRanking.length === 0 ? <p className="text-sm text-muted-foreground">No ranking data available.</p> : forecastRanking.slice(0, 5).map((row, index) => {
                    const asset = row.asset ?? row.symbol ?? "—";
                    const score = Number(row.score ?? 0);
                    return (
                      <div key={`${asset}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ background: "oklch(1 0 0 / 3%)", borderColor: "oklch(1 0 0 / 8%)" }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground/50 w-4">{index + 1}</span>
                          <span style={{ color: ASSET_COLORS[asset] ?? assetColor }}>{ASSET_ICONS[asset] ?? asset[0]}</span>
                          <span className="font-semibold text-foreground/85">{asset}</span>
                        </div>
                        <span className="mono-data font-bold" style={{ color: ASSET_COLORS[asset] ?? assetColor }}>{score.toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="panel p-5">
                <SectionTitle icon={<Clock size={14} className="text-primary opacity-70" />}>Recent signal history</SectionTitle>
                <div className="space-y-3">
                  {history.length === 0 ? <p className="text-sm text-muted-foreground">No history available.</p> : history.slice(0, 5).map((row, index) => {
                    const action = String(row.action ?? "HOLD");
                    const reason = String(row.reason ?? "No reason supplied");
                    const timestamp = String(row.timestamp ?? row.signal_date ?? `Row ${index + 1}`);
                    return (
                      <div key={`history-${index}`} className="rounded-xl border border-border/20 p-3 bg-card/20">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-sm font-semibold text-foreground mono-data break-all">{timestamp}</p>
                          <p className="text-xs font-semibold" style={{ color: action === "BUY" ? toneColor("good") : action === "SELL" ? toneColor("warn") : "oklch(0.72 0.02 260)" }}>{action}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">{reason}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="panel p-5">
                <SectionTitle icon={<Clock size={14} className="text-primary opacity-70" />}>Live counters</SectionTitle>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Trades", liveStrategy?.performance?.counters?.trades],
                    ["Rotations", liveStrategy?.performance?.counters?.rotations],
                    ["Cash Exits", liveStrategy?.performance?.counters?.cashExits],
                    ["All-Neg Exits", liveStrategy?.performance?.counters?.allNegativeExits],
                    ["All-Neg Blocked", liveStrategy?.performance?.counters?.allNegativeBlocked],
                    ["Rule 2 Blocks", liveStrategy?.performance?.counters?.rule2Blocks],
                    ["Rule 3 Blocks", liveStrategy?.performance?.counters?.rule3Blocks],
                    ["Rule 3 Force BTC", liveStrategy?.performance?.counters?.rule3ForceBtc],
                    ["Rule 4 Blocks", liveStrategy?.performance?.counters?.rule4Blocks],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg border border-border/20 px-3 py-2 bg-card/20">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-bold text-white mono-data">{counterValue(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
