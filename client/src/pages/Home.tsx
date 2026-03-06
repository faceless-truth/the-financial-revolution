/**
 * The Financial Revolution — Strategy Dashboard
 * Design: Dark Precision — deep navy panels, luminous data, colour-coded signals
 * Fonts: Syne (display/numbers) + Geist (labels) + JetBrains Mono (data)
 */

import { useBinanceData, type OHLCVRow } from "@/hooks/useBinanceData";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  formatPrice,
  formatPct,
  signalActionLabel,
  signalActionClass,
  cashTriggerClass,
  momentumClass,
  drawdownClass,
  timeAgo,
} from "@/lib/formatters";
import { useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle, Clock, Zap, Target, BarChart2, Activity } from "lucide-react";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/dashboard-hero-bg-hgsqEWzXFhZWuFZbadExQL.webp";

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◎",
  SUI: "🌊",
  DOGE: "Ð",
};

const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.70 0.15 290)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.65 0.20 220)",
  DOGE: "oklch(0.78 0.18 75)",
};

// ── Skeleton loader ────────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer ${className}`} />;
}

// ── Animated number ────────────────────────────────────────────────────────────
function AnimatedNumber({ value, className = "" }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    setDisplay(value);
  }, [value]);
  return <span key={display} className={`animate-count-up inline-block ${className}`}>{display}</span>;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ rows, color }: { rows: OHLCVRow[]; color: string }) {
  const data = rows.slice(-14).map((r) => ({ v: r.close }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
        <Tooltip
          contentStyle={{ background: "oklch(0.13 0.012 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 6, fontSize: 10 }}
          formatter={(v: number) => [formatPrice(v), ""]}
          labelFormatter={() => ""}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-primary opacity-70">{icon}</span>
      <div>
        <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground/60 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Signal badge ───────────────────────────────────────────────────────────────
function SignalBadge({ action, large = false }: { action: string; large?: boolean }) {
  const cls = signalActionClass(action as never);
  const isActive = action === "BUY" || action === "SELL_ALL";
  return (
    <span
      className={`${cls} border rounded-md font-bold tracking-wider uppercase ${large ? "text-2xl px-5 py-2" : "text-xs px-2.5 py-1"} ${isActive ? "animate-signal-pulse" : ""}`}
      style={{ fontFamily: "Syne, sans-serif" }}
    >
      {signalActionLabel(action as never)}
    </span>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function DrawdownBar({ drawdown, partial, full }: { drawdown: number; partial: number; full: number }) {
  const pct = Math.min(drawdown * 100, 100);
  const color = drawdown >= full ? "oklch(0.62 0.22 25)" : drawdown >= partial ? "oklch(0.78 0.18 75)" : "oklch(0.72 0.18 155)";
  return (
    <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
      {/* Threshold markers */}
      <div className="absolute top-0 h-full w-px bg-amber-400/60 z-10" style={{ left: `${partial * 100}%` }} />
      <div className="absolute top-0 h-full w-px bg-red-400/60 z-10" style={{ left: `${full * 100}%` }} />
      {/* Fill */}
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}

// ── Decision flow rule row ─────────────────────────────────────────────────────
function RuleRow({
  step,
  label,
  condition,
  result,
  active,
  triggered,
  passed,
}: {
  step: number;
  label: string;
  condition: string;
  result: string;
  active: boolean;
  triggered: boolean;
  passed: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${
        triggered
          ? "border-amber-500/40 bg-amber-500/8"
          : active && passed
          ? "border-emerald-500/20 bg-emerald-500/5"
          : active
          ? "border-border/50 bg-card/50"
          : "border-border/20 opacity-40"
      }`}
    >
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
          triggered ? "bg-amber-500/20 text-amber-400" : passed ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
        }`}
        style={{ fontFamily: "Syne, sans-serif" }}
      >
        {triggered ? "!" : passed ? "✓" : step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground/90" style={{ fontFamily: "Geist, sans-serif" }}>{label}</span>
          {triggered && (
            <span className="text-xs text-amber-400 font-mono shrink-0">TRIGGERED</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 mono-data">{condition}</p>
        {triggered && <p className="text-xs text-amber-300 mt-1 font-medium">→ {result}</p>}
      </div>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function Home() {
  const { signal, loading, error, lastUpdated, rawData } = useBinanceData(5 * 60 * 1000);
  const [tick, setTick] = useState(0);

  // Refresh relative time display every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const btcMetrics = signal?.assetMetrics?.BTC;
  const btcPrice = btcMetrics?.currentPrice ?? 0;

  // Decision flow evaluation
  const rule = signal?.ruleTriggered ?? "";
  const df = {
    cashFull: rule === "CASH_FULL",
    cashPartial: rule === "CASH_PARTIAL",
    minHold: rule === "MIN_HOLD",
    btcRally: rule === "BTC_RALLY",
    noBreakout: rule === "NO_BREAKOUT",
    btcBest: rule === "BTC_BEST",
    altBreakout: rule === "ALT_BREAKOUT",
    allNegative: rule === "ALL_NEGATIVE",
  };

  const anyCashTrigger = df.cashFull || df.cashPartial;
  const pastCash = !anyCashTrigger;
  const pastMinHold = pastCash && !df.minHold;
  const pastBtcRally = pastMinHold && !df.btcRally;
  const pastBreakout = pastBtcRally && !df.noBreakout;

  return (
    <div className="min-h-screen" style={{ fontFamily: "Geist, sans-serif", background: "oklch(0.09 0.012 260)" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden border-b border-border/30"
        style={{ background: `linear-gradient(to bottom, oklch(0.11 0.015 255 / 95%), oklch(0.09 0.012 260))` }}
      >
        <div
          className="absolute inset-0 opacity-20"
          style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center top" }}
        />
        <div className="relative container py-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.60 0.22 255 / 20%)", border: "1px solid oklch(0.60 0.22 255 / 30%)" }}>
                <Zap size={16} className="text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                  The Financial <span className="text-primary opacity-80">Revolution</span>
                </h1>
                <p className="text-xs text-muted-foreground">Conservative Momentum Strategy · Live Binance Data</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* BTC price pill */}
            {btcPrice > 0 && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40" style={{ background: "oklch(0.13 0.012 260)" }}>
                <span className="text-amber-400 text-sm font-bold" style={{ fontFamily: "Syne, sans-serif" }}>₿</span>
                <span className="text-sm font-semibold text-white mono-data">{formatPrice(btcPrice)}</span>
                {btcMetrics && (
                  <span className={`text-xs mono-data ${btcMetrics.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatPct(btcMetrics.priceChange24h)}
                  </span>
                )}
              </div>
            )}

            {/* Last updated */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              <span>{lastUpdated ? timeAgo(lastUpdated) : "Loading..."}</span>
            </div>

            {/* Signal badge */}
            {signal && <SignalBadge action={signal.action} />}
          </div>
        </div>
      </header>

      <div className="container py-6 space-y-6">

        {/* ── ERROR ──────────────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
            <AlertTriangle size={16} />
            <span>Data fetch error: {error}. Retrying automatically.</span>
          </div>
        )}

        {/* ── ROW 1: Signal + Re-Entry Trigger ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* TODAY'S SIGNAL */}
          <div className="panel p-5 flex flex-col gap-4 glow-blue" style={{ borderColor: "oklch(0.60 0.22 255 / 20%)" }}>
            <SectionHeader icon={<Zap size={14} />} title="Today's Signal" subtitle="Daily candle close evaluation" />
            {loading && !signal ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : signal ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <SignalBadge action={signal.action} large />
                  <div>
                    <p className="text-xs text-muted-foreground">Rule</p>
                    <p className="text-sm font-semibold mono-data text-foreground">{signal.ruleTriggered || "—"}</p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed">{signal.reason}</p>

                {/* Target positions */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Target Allocation</p>
                  {Object.keys(signal.targetPositions).length === 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: "oklch(0.60 0.22 255 / 15%)", color: "oklch(0.60 0.22 255)" }}>$</div>
                      <div>
                        <p className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>CASH</p>
                        <p className="text-xs text-muted-foreground">100% cash</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(signal.targetPositions).map(([asset, alloc]) => (
                        <div key={asset} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg" style={{ color: ASSET_COLORS[asset] }}>{ASSET_ICONS[asset] ?? asset}</span>
                            <span className="text-sm font-semibold text-foreground">{asset}</span>
                          </div>
                          <span className="text-sm font-bold mono-data" style={{ color: ASSET_COLORS[asset] }}>
                            {((alloc ?? 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confidence */}
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                    <span>Signal Confidence</span>
                    <span className="mono-data">{(signal.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${signal.confidence * 100}%`,
                        background: signal.confidence > 0.6 ? "oklch(0.72 0.18 155)" : signal.confidence > 0.3 ? "oklch(0.78 0.18 75)" : "oklch(0.60 0.22 255)",
                      }}
                    />
                  </div>
                </div>

                {/* Allocation multiplier */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Allocation Multiplier</span>
                  <span className={`font-bold mono-data ${signal.allocationMultiplier === 1 ? "text-emerald-400" : signal.allocationMultiplier === 0.5 ? "text-amber-400" : "text-red-400"}`}>
                    {(signal.allocationMultiplier * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* RE-ENTRY TRIGGER — 2nd position */}
          <div className="panel p-5 flex flex-col gap-4">
            <SectionHeader icon={<TrendingUp size={14} />} title="Re-Entry Trigger" subtitle="BTC price needed to flip 30-day momentum positive" />
            {loading && !signal ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : signal ? (
              <div className="space-y-4">
                {signal.reentry.alreadyMet ? (
                  <div className="flex items-center gap-3 p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/8">
                    <CheckCircle size={20} className="text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-300">Momentum Already Positive</p>
                      <p className="text-xs text-muted-foreground mt-0.5">BTC 30-day momentum is positive — re-entry trigger already met</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg border border-border/40" style={{ background: "oklch(1 0 0 / 3%)" }}>
                        <p className="text-xs text-muted-foreground mb-1">Trigger Price</p>
                        <p className="text-xl font-bold mono-data text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                          {formatPrice(signal.reentry.triggerPrice)}
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">BTC close from 30 days ago</p>
                      </div>
                      <div className="p-3 rounded-lg border border-border/40" style={{ background: "oklch(1 0 0 / 3%)" }}>
                        <p className="text-xs text-muted-foreground mb-1">Gap to Trigger</p>
                        <p className={`text-xl font-bold mono-data ${signal.reentry.gapPct >= 0 ? "text-emerald-400" : "text-red-400"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {formatPct(signal.reentry.gapPct)}
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">{signal.reentry.gapUsd >= 0 ? "+" : ""}{formatPrice(Math.abs(signal.reentry.gapUsd), 0)} USD</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      When BTC closes above <span className="text-white font-semibold mono-data">{formatPrice(signal.reentry.triggerPrice)}</span>, the 30-day momentum flips positive and re-entry is evaluated.
                    </p>
                  </div>
                )}
                {signal.reentry.rollingTriggers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Rolling Thresholds (window shifts daily)</p>
                    <div className="space-y-1.5">
                      {signal.reentry.rollingTriggers.map((r) => (
                        <div key={r.daysFromNow} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground mono-data">In {r.daysFromNow}d</span>
                          <span className="font-semibold mono-data text-foreground/80">{formatPrice(r.triggerPrice)}</span>
                          <span className={`mono-data ${r.deltaVsTodayUsd < 0 ? "text-emerald-400" : "text-amber-400"}`}>
                            {r.deltaVsTodayUsd < 0 ? "↓ drops" : "↑ rises"} {formatPct(Math.abs(r.deltaVsTodayPct), false)}
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

        {/* ── ROW 1b: BTC Health (full width) ─────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4">
          <div className="panel p-5 flex flex-col gap-4">
            <SectionHeader icon={<Activity size={14} />} title="BTC Health" subtitle="30-day drawdown & cash triggers" />
            {loading && !signal ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : signal ? (
              <div className="space-y-4">
                {/* Current price */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">BTC Price</p>
                  <div className="flex items-baseline gap-2">
                    <AnimatedNumber
                      value={formatPrice(btcPrice)}
                      className="text-3xl font-bold text-white data-number"
                    />
                    {btcMetrics && (
                      <span className={`text-sm mono-data ${btcMetrics.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {formatPct(btcMetrics.priceChange24h)} 24h
                      </span>
                    )}
                  </div>
                </div>

                {/* 30d high */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">30-Day High</span>
                  <span className="font-semibold mono-data text-foreground">{formatPrice(signal.btc30dHigh)}</span>
                </div>

                {/* Drawdown bar */}
                <div>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-muted-foreground">Drawdown from 30d High</span>
                    <AnimatedNumber
                      value={formatPct(signal.btcDrawdown * 100, false)}
                      className={`font-bold mono-data ${drawdownClass(signal.btcDrawdown)}`}
                    />
                  </div>
                  <DrawdownBar
                    drawdown={signal.btcDrawdown}
                    partial={0.12}
                    full={0.25}
                  />
                  <div className="flex justify-between text-xs mt-1.5 text-muted-foreground/60">
                    <span>0%</span>
                    <span className="text-amber-400/70">12% partial</span>
                    <span className="text-red-400/70">25% full</span>
                  </div>
                </div>

                {/* Trigger prices */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <p className="text-xs text-amber-400/70 mb-1">Partial Cash at</p>
                    <p className="text-sm font-bold mono-data text-amber-300">{formatPrice(signal.partialTriggerPrice)}</p>
                    <p className="text-xs text-muted-foreground/60">→ 50% allocation</p>
                  </div>
                  <div className="p-2.5 rounded-lg border border-red-500/20 bg-red-500/5">
                    <p className="text-xs text-red-400/70 mb-1">Full Cash at</p>
                    <p className="text-sm font-bold mono-data text-red-300">{formatPrice(signal.fullTriggerPrice)}</p>
                    <p className="text-xs text-muted-foreground/60">→ 0% allocation</p>
                  </div>
                </div>

                {/* BTC rallying status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">BTC Rallying (new high 5d)</span>
                  <span className={`flex items-center gap-1.5 font-semibold ${signal.btcRallying ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {signal.btcRallying ? <><CheckCircle size={13} /> YES</> : <><XCircle size={13} /> NO</>}
                  </span>
                </div>

                {/* Cash trigger status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Cash Trigger Status</span>
                  <span className={`${cashTriggerClass(signal.cashTriggerStatus)} border rounded px-2 py-0.5 text-xs font-bold`}>
                    {signal.cashTriggerStatus}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

        </div>

        {/* ── ROW 2: Momentum Scores + Decision Flow ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* MOMENTUM SCORES */}
          <div className="panel p-5">
            <SectionHeader icon={<BarChart2 size={14} />} title="30-Day Momentum Scores" subtitle="Ranked by performance — best asset drives signal" />
            {loading && !signal ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : signal ? (
              <div className="space-y-2">
                {signal.momentumRanked.map(({ asset, score }, idx) => {
                  const metrics = signal.assetMetrics[asset];
                  const isTarget = asset in signal.targetPositions;
                  const maxAbs = Math.max(...signal.momentumRanked.map((r) => Math.abs(r.score)), 1);
                  const barWidth = Math.abs(score) / maxAbs * 100;
                  const isPositive = score >= 0;

                  return (
                    <div
                      key={asset}
                      className={`relative p-3 rounded-lg border transition-all duration-300 ${
                        isTarget
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-border/30 hover:border-border/60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Rank */}
                        <span className="text-xs text-muted-foreground/60 w-4 text-center font-mono">{idx + 1}</span>

                        {/* Asset icon */}
                        <span className="text-xl w-8 text-center" style={{ color: ASSET_COLORS[asset] }}>
                          {ASSET_ICONS[asset] ?? asset}
                        </span>

                        {/* Asset name + price */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>{asset}</span>
                              {isTarget && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">TARGET</span>
                              )}
                              {idx === 0 && !isTarget && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">BEST</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {metrics && (
                                <span className="text-xs text-muted-foreground mono-data">{formatPrice(metrics.currentPrice)}</span>
                              )}
                              <AnimatedNumber
                                value={formatPct(score)}
                                className={`text-sm font-bold mono-data ${momentumClass(score)}`}
                              />
                            </div>
                          </div>

                          {/* Bar */}
                          <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 6%)" }}>
                            <div
                              className="absolute top-0 h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${barWidth}%`,
                                left: isPositive ? "0" : undefined,
                                right: isPositive ? undefined : "0",
                                background: isPositive ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)",
                              }}
                            />
                          </div>
                        </div>

                        {/* Near high indicator */}
                        {metrics && (
                          <div className="flex flex-col items-center gap-0.5 shrink-0">
                            <span className={`text-xs ${metrics.nearHigh ? "text-emerald-400" : "text-muted-foreground/40"}`}>
                              {metrics.nearHigh ? <TrendingUp size={12} /> : <Minus size={12} />}
                            </span>
                            <span className="text-xs text-muted-foreground/40" style={{ fontSize: "9px" }}>HIGH</span>
                          </div>
                        )}
                      </div>

                      {/* Extra metrics row */}
                      {metrics && (
                        <div className="flex items-center gap-4 mt-2 pl-11">
                          <span className="text-xs text-muted-foreground/60 mono-data">
                            30d High: <span className="text-foreground/60">{formatPrice(metrics.high30)}</span>
                          </span>
                          <span className="text-xs text-muted-foreground/60 mono-data">
                            DD: <span className={drawdownClass(metrics.drawdown30)}>{formatPct(metrics.drawdown30 * 100, false)}</span>
                          </span>
                          <span className={`text-xs mono-data ${metrics.priceChange24h >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                            24h: {formatPct(metrics.priceChange24h)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* DECISION FLOW */}
          <div className="panel p-5">
            <SectionHeader icon={<Target size={14} />} title="Decision Flow" subtitle="Rules evaluated in order — daily candle close only" />
            {loading && !signal ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : signal ? (
              <div className="space-y-2">
                <RuleRow
                  step={1}
                  label="Full Cash Trigger"
                  condition={`BTC down ≥25% from 30d high? (currently ${formatPct(signal.btcDrawdown * 100, false)})`}
                  result="→ CASH (0% allocation)"
                  active={true}
                  triggered={df.cashFull}
                  passed={!df.cashFull}
                />
                <RuleRow
                  step={2}
                  label="Partial Cash Trigger"
                  condition={`BTC down ≥12% from 30d high? (currently ${formatPct(signal.btcDrawdown * 100, false)})`}
                  result="→ 50% allocation"
                  active={!df.cashFull}
                  triggered={df.cashPartial}
                  passed={!df.cashPartial && !df.cashFull}
                />
                <RuleRow
                  step={3}
                  label="Minimum Hold Period"
                  condition="Held current position < 14 days? → DON'T rotate"
                  result="→ Hold current position"
                  active={pastCash}
                  triggered={df.minHold}
                  passed={pastMinHold}
                />
                <RuleRow
                  step={4}
                  label="BTC Rally Filter"
                  condition={`BTC made new high in last 5 days? (${signal.btcRallying ? "YES" : "NO"})`}
                  result="→ Stay BTC (no alts)"
                  active={pastMinHold}
                  triggered={df.btcRally}
                  passed={pastBtcRally}
                />
                <RuleRow
                  step={5}
                  label="Alt Breakout Confirmation"
                  condition={`Best alt near its 30d high (within 5%)? (${signal.momentumRanked[0]?.asset !== "BTC" ? (signal.assetMetrics[signal.momentumRanked[0]?.asset]?.nearHigh ? "YES" : "NO") : "N/A — BTC is best"})`}
                  result="→ Stay BTC (no breakout)"
                  active={pastBtcRally}
                  triggered={df.noBreakout}
                  passed={pastBreakout}
                />
                <RuleRow
                  step={6}
                  label="Asset Selection"
                  condition={`Best momentum: ${signal.momentumRanked[0]?.asset ?? "—"} (${formatPct(signal.momentumRanked[0]?.score ?? 0)})`}
                  result={`→ ${signal.reason}`}
                  active={pastBreakout}
                  triggered={df.btcBest || df.altBreakout || df.allNegative}
                  passed={df.btcBest || df.altBreakout}
                />

                {/* Active rule summary */}
                <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <p className="text-xs text-muted-foreground mb-1">Active Rule</p>
                  <p className="text-sm font-semibold text-foreground mono-data">{signal.ruleTriggered || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{signal.reason}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>


        {/* ── ROW 3.5: BTC 30-day chart ───────────────────────────────────────── */}
        {rawData.BTC && rawData.BTC.length >= 30 && (
          <div className="panel p-5">
            <SectionHeader icon={<Activity size={14} />} title="BTC 30-Day Price History" subtitle="Daily close prices from Binance" />
            <ResponsiveContainer width="100%" height={160}>
              <LineChart
                data={rawData.BTC.slice(-30).map((r) => ({ date: r.date.slice(5), price: r.close }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis dataKey="date" tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis
                  domain={["auto", "auto"]}
                  tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                  tickFormatter={(v) => formatPrice(v)}
                />
                {signal && (
                  <>
                    <ReferenceLine y={signal.btc30dHigh} stroke="oklch(0.78 0.18 75)" strokeDasharray="4 2" strokeOpacity={0.6} />
                    <ReferenceLine y={signal.partialTriggerPrice} stroke="oklch(0.78 0.18 75)" strokeDasharray="2 4" strokeOpacity={0.4} />
                    <ReferenceLine y={signal.fullTriggerPrice} stroke="oklch(0.62 0.22 25)" strokeDasharray="4 2" strokeOpacity={0.5} />
                    {!signal.reentry.alreadyMet && (
                      <ReferenceLine y={signal.reentry.triggerPrice} stroke="oklch(0.60 0.22 255)" strokeDasharray="3 3" strokeOpacity={0.5} />
                    )}
                  </>
                )}
                <Line type="monotone" dataKey="price" stroke="oklch(0.78 0.18 75)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "oklch(0.78 0.18 75)" }} />
                <Tooltip
                  contentStyle={{ background: "oklch(0.13 0.012 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 6, fontSize: 11 }}
                  formatter={(v: number) => [formatPrice(v), "BTC Close"]}
                />
              </LineChart>
            </ResponsiveContainer>
            {signal && (
              <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground/60">
                <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.78 0.18 75 / 60%)", borderTop: "1px dashed" }} /> 30d High: <span className="text-amber-300 font-semibold mono-data">{formatPrice(signal.btc30dHigh)}</span></span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.78 0.18 75 / 40%)", borderTop: "1px dashed" }} /> Partial cash: <span className="text-amber-400/80 mono-data">{formatPrice(signal.partialTriggerPrice)}</span></span>
                <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.62 0.22 25 / 50%)", borderTop: "1px dashed" }} /> Full cash: <span className="text-red-400/80 mono-data">{formatPrice(signal.fullTriggerPrice)}</span></span>
                {!signal.reentry.alreadyMet && (
                  <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.60 0.22 255 / 50%)", borderTop: "1px dashed" }} /> Re-entry: <span className="text-primary/80 mono-data">{formatPrice(signal.reentry.triggerPrice)}</span></span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ROW 4: Per-Asset Detail Cards ───────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary opacity-70" />
            <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Per-Asset Detail</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(["BTC", "ETH", "SOL", "SUI", "DOGE"] as const).map((asset) => {
              const metrics = signal?.assetMetrics?.[asset];
              const isTarget = signal && asset in signal.targetPositions;
              const score = signal?.momentumScores?.[asset] ?? 0;
              const rank = signal?.momentumRanked.findIndex((r) => r.asset === asset) ?? -1;

              return (
                <div
                  key={asset}
                  className={`panel p-4 flex flex-col gap-3 transition-all duration-300 ${
                    isTarget ? "glow-buy" : ""
                  }`}
                  style={isTarget ? { borderColor: "oklch(0.72 0.18 155 / 30%)" } : {}}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" style={{ color: ASSET_COLORS[asset] }}>{ASSET_ICONS[asset]}</span>
                      <div>
                        <p className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>{asset}</p>
                        <p className="text-xs text-muted-foreground/50">#{rank + 1}</p>
                      </div>
                    </div>
                    {isTarget && (
                      <CheckCircle size={14} className="text-emerald-400" />
                    )}
                  </div>

                  {loading && !metrics ? (
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  ) : metrics ? (
                    <>
                      {/* Price */}
                      <div>
                        <p className="text-xs text-muted-foreground">Price</p>
                        <p className="text-base font-bold mono-data text-foreground">{formatPrice(metrics.currentPrice)}</p>
                        <p className={`text-xs mono-data ${metrics.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {formatPct(metrics.priceChange24h)} 24h
                        </p>
                      </div>

                      {/* Momentum */}
                      <div>
                        <p className="text-xs text-muted-foreground">30d Momentum</p>
                        <p className={`text-lg font-bold mono-data ${momentumClass(score)}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {formatPct(score)}
                        </p>
                      </div>

                      {/* Drawdown mini bar */}
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground/60">DD from 30d</span>
                          <span className={`mono-data ${drawdownClass(metrics.drawdown30)}`}>{formatPct(metrics.drawdown30 * 100, false)}</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(metrics.drawdown30 * 100 / 50 * 100, 100)}%`,
                              background: drawdownClass(metrics.drawdown30).includes("emerald") ? "oklch(0.72 0.18 155)" : drawdownClass(metrics.drawdown30).includes("amber") ? "oklch(0.78 0.18 75)" : "oklch(0.62 0.22 25)",
                            }}
                          />
                        </div>
                      </div>

                      {/* Sparkline */}
                      {rawData[asset] && rawData[asset]!.length >= 14 && (
                        <div className="-mx-1">
                          <Sparkline rows={rawData[asset]!} color={ASSET_COLORS[asset]} />
                        </div>
                      )}

                      {/* Near high */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground/60">Near 30d High</span>
                        <span className={metrics.nearHigh ? "text-emerald-400" : "text-muted-foreground/40"}>
                          {metrics.nearHigh ? "✓ Yes" : "✗ No"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground/40">No data</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
        <footer className="border-t border-border/20 pt-4 pb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/50">
            <p>The Financial Revolution · Conservative Parameters · TFR Investing Engine</p>
            <p className="mono-data">
              {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : "Fetching live data..."}
              {" · "}Refreshes every 5 min
            </p>
          </div>
          <p className="text-xs text-muted-foreground/30 mt-2 text-center">
            For informational purposes only. Not financial advice. Backtest: +413% return, +211pp vs BTC (2021–2026), 53–60% max drawdown.
          </p>
        </footer>

      </div>
    </div>
  );
}
