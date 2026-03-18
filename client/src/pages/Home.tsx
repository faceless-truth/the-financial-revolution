import { useEffect, useMemo, useState } from "react";
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
  const planning = data?.planning ?? {};
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
                  <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: 'Geist, sans-serif' }}>Rotation Readiness</h2>
                </div>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-semibold">Current blocker:</span> {planning.currentBlocker ?? "Monitoring live conditions"}</p>
                  <p><span className="text-foreground font-semibold">Candidate:</span> {planning.candidateAsset ?? data.preparation?.targetAsset ?? "Watching leaders"}</p>
                  <p><span className="text-foreground font-semibold">Earliest eligible run:</span> {planning.earliestEligibleRunLabel ?? "Watching next close"}</p>
                  <p><span className="text-foreground font-semibold">Rule 4:</span> {planning.rule4Ready === true ? "Ready" : planning.rule4Ready === false ? "Pending confirmation" : "Monitoring"}</p>
                  <p>{planning.nextActionSummary ?? "The dashboard now reflects the live droplet script state, including current blockers and earliest eligible rotation timing."}</p>
                </div>
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
