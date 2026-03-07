/**
 * The Financial Revolution — Strategy Dashboard
 * Design: Dark Precision — deep navy panels, luminous data, colour-coded signals
 * Fonts: Syne (display/numbers) + Geist (labels) + JetBrains Mono (data)
 * Strategy: Unified Momentum v7.0 — 14-day pairwise, 5-regime, Confidence v3, Leverage Gate
 */

import { useBinanceData, type Candle, type RegimeType, MAJORS, PER_ASSET_CAPS, LEVERAGE_CONFIDENCE_THRESHOLD, ADAPTIVE_THRESHOLDS, REGIME_ALLOCATION } from "@/hooks/useBinanceData";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  formatPrice,
  formatPct,
  timeAgo,
} from "@/lib/formatters";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle, Zap, Target, BarChart2, Activity, Shield, Gauge } from "lucide-react";

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663335455300/f7qptPGnBE9WgCNPQkiCv7/dashboard-hero-bg-hgsqEWzXFhZWuFZbadExQL.webp";

const ASSET_ICONS: Record<string, string> = {
  BTC: "₿", ETH: "Ξ", SOL: "◎", SUI: "🌊", DOGE: "Ð",
};

const ASSET_COLORS: Record<string, string> = {
  BTC: "oklch(0.78 0.18 75)",
  ETH: "oklch(0.70 0.15 290)",
  SOL: "oklch(0.72 0.18 155)",
  SUI: "oklch(0.65 0.20 220)",
  DOGE: "oklch(0.78 0.18 75)",
};

// ── Regime display helpers ─────────────────────────────────────────────────────
const REGIME_LABELS: Record<RegimeType, string> = {
  STRONG_INVEST: "Strong Invest",
  INVEST: "Invest",
  NEUTRAL: "Neutral",
  CASH: "Cash",
  STRONG_CASH: "Strong Cash",
};

const REGIME_COLORS: Record<RegimeType, string> = {
  STRONG_INVEST: "text-emerald-300",
  INVEST: "text-emerald-400",
  NEUTRAL: "text-amber-400",
  CASH: "text-red-400",
  STRONG_CASH: "text-red-300",
};

const REGIME_BORDER: Record<RegimeType, string> = {
  STRONG_INVEST: "border-emerald-500/30 bg-emerald-500/5",
  INVEST: "border-emerald-500/20 bg-emerald-500/5",
  NEUTRAL: "border-amber-500/20 bg-amber-500/5",
  CASH: "border-red-500/20 bg-red-500/5",
  STRONG_CASH: "border-red-500/30 bg-red-500/8",
};

const CONFIDENCE_ZONE_COLORS: Record<string, string> = {
  HIGH: "text-emerald-300",
  "MED-HIGH": "text-emerald-400",
  MED: "text-amber-400",
  "MED-LOW": "text-orange-400",
  LOW: "text-red-400",
};

// ── Signal action display ──────────────────────────────────────────────────────
function signalClass(action: string): string {
  switch (action) {
    case "BUY": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "SELL_ALL": return "text-red-400 border-red-500/40 bg-red-500/10";
    case "ROTATE": return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "REBALANCE": return "text-blue-400 border-blue-500/40 bg-blue-500/10";
    case "INCREASE": return "text-emerald-300 border-emerald-400/40 bg-emerald-400/10";
    case "REDUCE": return "text-orange-400 border-orange-500/40 bg-orange-500/10";
    default: return "text-muted-foreground border-border/40 bg-muted/10";
  }
}

function momentumClass(v: number): string {
  if (v >= 10) return "text-emerald-400";
  if (v >= 0) return "text-emerald-300/70";
  if (v >= -10) return "text-amber-400";
  return "text-red-400";
}

function drawdownClass(v: number): string {
  const abs = Math.abs(v);
  if (abs <= 5) return "text-emerald-400";
  if (abs <= 12) return "text-amber-400";
  return "text-red-400";
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer ${className}`} />;
}

function AnimatedNumber({ value, className = "" }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => { setDisplay(value); }, [value]);
  return <span key={display} className={`animate-count-up inline-block ${className}`}>{display}</span>;
}

function Sparkline({ candles, color }: { candles: Candle[]; color: string }) {
  const data = candles.slice(-14).map(c => ({ v: c.close }));
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

function SignalBadge({ action, large = false }: { action: string; large?: boolean }) {
  const isActive = action === "BUY" || action === "SELL_ALL";
  return (
    <span
      className={`${signalClass(action)} border rounded-md font-bold tracking-wider uppercase ${large ? "text-2xl px-5 py-2" : "text-xs px-2.5 py-1"} ${isActive ? "animate-signal-pulse" : ""}`}
      style={{ fontFamily: "Syne, sans-serif" }}
    >
      {action.replace("_", " ")}
    </span>
  );
}

function ConfidenceBar({ score, zone }: { score: number; zone: string }) {
  const color = zone === "HIGH" ? "oklch(0.72 0.18 155)" : zone === "MED-HIGH" ? "oklch(0.72 0.18 155 / 80%)" : zone === "MED" ? "oklch(0.78 0.18 75)" : zone === "MED-LOW" ? "oklch(0.75 0.20 50)" : "oklch(0.62 0.22 25)";
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score * 100}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function Home() {
  const { signal, assets, rankedAssets, regime, confidence, rawData, loading, error, lastUpdated } = useBinanceData(5 * 60 * 1000);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const btcAsset = assets["BTC"];
  const btcPrice = btcAsset?.price ?? 0;
  const btcCandles = rawData["BTC"] ?? [];
  const btcHigh30 = btcCandles.length >= 30 ? Math.max(...btcCandles.slice(-30).map(c => c.high)) : 0;
  const btcDrawdownPct = btcHigh30 > 0 ? ((btcPrice - btcHigh30) / btcHigh30) * 100 : 0; // negative = below high

  // Re-entry: BTC price needed to make 14-day momentum positive
  const btc14dAgo = btcCandles.length >= 15 ? btcCandles[btcCandles.length - 15].close : 0;
  const reentryMet = btc14dAgo > 0 && btcPrice > btc14dAgo;
  const reentryGapUsd = btc14dAgo - btcPrice;
  const reentryGapPct = btc14dAgo > 0 ? ((btcPrice / btc14dAgo) - 1) * 100 : 0;

  // Rolling re-entry thresholds (next 7 days)
  const rollingReentry = btcCandles.length >= 22
    ? Array.from({ length: 7 }, (_, i) => {
        const idx = btcCandles.length - 14 + i; // candle that will be 14d ago in i days
        if (idx < 0 || idx >= btcCandles.length) return null;
        const tp = btcCandles[idx].close;
        return { day: i + 1, triggerPrice: tp, gapPct: ((btcPrice / tp) - 1) * 100 };
      }).filter(Boolean) as Array<{ day: number; triggerPrice: number; gapPct: number }>
    : [];

  return (
    <div className="min-h-screen" style={{ fontFamily: "Geist, sans-serif", background: "oklch(0.09 0.012 260)" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden border-b border-border/30" style={{ background: `linear-gradient(to bottom, oklch(0.11 0.015 255 / 95%), oklch(0.09 0.012 260))` }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `url(${HERO_BG})`, backgroundSize: "cover", backgroundPosition: "center top" }} />
        <div className="relative container py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "oklch(0.60 0.22 255 / 20%)", border: "1px solid oklch(0.60 0.22 255 / 30%)" }}>
              <Zap size={16} className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: "Syne, sans-serif" }}>
                The Financial <span className="text-primary opacity-80">Revolution</span>
              </h1>
              <p className="text-xs text-muted-foreground">Unified Momentum v7.0 · Live Binance Data · Executes 00:05 UTC</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {btcPrice > 0 && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/40" style={{ background: "oklch(0.13 0.012 260)" }}>
                <span className="text-amber-400 text-sm font-bold" style={{ fontFamily: "Syne, sans-serif" }}>₿</span>
                <span className="text-sm font-semibold text-white mono-data">{formatPrice(btcPrice)}</span>
                {btcAsset && (
                  <span className={`text-xs mono-data ${btcAsset.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatPct(btcAsset.change24h)}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              <span>{lastUpdated ? timeAgo(lastUpdated) : "Loading..."}</span>
            </div>
            {signal && <SignalBadge action={signal.action} />}
          </div>
        </div>
      </header>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/20" style={{ background: "oklch(0.13 0.012 260 / 95%)" }}>
        <div className="container flex items-center gap-1">
          <div className="px-4 py-2.5 text-xs font-semibold border-b-2 cursor-default" style={{ color: "oklch(0.60 0.22 255)", borderColor: "oklch(0.60 0.22 255)" }}>
            Strategy Dashboard
          </div>
          <Link href="/portfolio">
            <div className="px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors border-b-2 border-transparent">
              My Portfolio
            </div>
          </Link>
        </div>
      </div>

      <div className="container py-6 space-y-6">

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
            <SectionHeader icon={<Zap size={14} />} title="Today's Signal" subtitle="Executes at 00:05 UTC on daily candle close" />
            {loading && !signal ? (
              <div className="space-y-3"><Skeleton className="h-12 w-32" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div>
            ) : signal ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <SignalBadge action={signal.action} large />
                  <div>
                    <p className="text-xs text-muted-foreground">Allocation Mode</p>
                    <p className="text-sm font-semibold mono-data text-foreground">{signal.allocationMode}</p>
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
                        <p className="text-xs text-muted-foreground">100% cash position</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(signal.targetPositions).map(([asset, alloc]) => (
                        <div key={asset} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg" style={{ color: ASSET_COLORS[asset] }}>{ASSET_ICONS[asset] ?? asset}</span>
                            <span className="text-sm font-semibold text-foreground">{asset}</span>
                            {(PER_ASSET_CAPS[asset as keyof typeof PER_ASSET_CAPS] ?? 1) < 1 && (
                              <span className="text-xs text-muted-foreground/50 mono-data">cap {(PER_ASSET_CAPS[asset as keyof typeof PER_ASSET_CAPS] * 100).toFixed(0)}%</span>
                            )}
                          </div>
                          <span className="text-sm font-bold mono-data" style={{ color: ASSET_COLORS[asset] }}>
                            {((alloc ?? 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                      {signal.allocationMode === "REMAINDER_SPLIT" && (
                        <p className="text-xs text-muted-foreground/60 mt-1">Remainder split: primary asset hit cap, excess allocated to 2nd-best</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Leverage */}
                <div className={`p-3 rounded-lg border ${signal.leverage > 1 ? "border-amber-500/30 bg-amber-500/8" : "border-border/20 bg-card/30"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Leverage Gate</span>
                    <span className={`text-sm font-bold mono-data ${signal.leverage > 1 ? "text-amber-300" : "text-muted-foreground"}`}>
                      {signal.leverage > 1 ? `${signal.leverage}x ACTIVE` : "1x (off)"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/60">{signal.leverageReason}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* RE-ENTRY TRIGGER */}
          <div className="panel p-5 flex flex-col gap-4">
            <SectionHeader icon={<Target size={14} />} title="Re-Entry Trigger" subtitle="BTC 14-day momentum flip — when to re-enter from cash" />
            {loading && !signal ? (
              <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-32 w-full" /></div>
            ) : (
              <div className="space-y-4">
                {/* Trigger price */}
                <div className={`p-4 rounded-lg border ${reentryMet ? "border-emerald-500/30 bg-emerald-500/8" : "border-primary/20 bg-primary/5"}`}>
                  <p className="text-xs text-muted-foreground mb-1">14-Day Ago BTC Price (momentum pivot)</p>
                  <AnimatedNumber
                    value={formatPrice(btc14dAgo)}
                    className="text-2xl font-bold text-white data-number"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    {reentryMet ? (
                      <><CheckCircle size={13} className="text-emerald-400" /><span className="text-xs text-emerald-400 font-semibold">Momentum POSITIVE — BTC qualifies</span></>
                    ) : (
                      <><XCircle size={13} className="text-red-400" /><span className="text-xs text-red-400 font-semibold">Momentum NEGATIVE — below re-entry</span></>
                    )}
                  </div>
                </div>

                {/* Gap */}
                {!reentryMet && btc14dAgo > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg border border-border/20 bg-card/30">
                      <p className="text-xs text-muted-foreground mb-1">Gap to Re-Entry</p>
                      <p className="text-sm font-bold mono-data text-foreground">{formatPrice(Math.abs(reentryGapUsd))}</p>
                    </div>
                    <div className="p-2.5 rounded-lg border border-border/20 bg-card/30">
                      <p className="text-xs text-muted-foreground mb-1">Gap %</p>
                      <p className={`text-sm font-bold mono-data ${reentryGapPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatPct(reentryGapPct)}</p>
                    </div>
                  </div>
                )}

                {/* Rolling thresholds */}
                {rollingReentry.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Rolling Thresholds (window shifts daily at 00:05 UTC)</p>
                    <div className="space-y-1.5">
                      {rollingReentry.map(r => (
                        <div key={r.day} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground mono-data">In {r.day}d</span>
                          <span className="font-semibold mono-data text-foreground/80">{formatPrice(r.triggerPrice)}</span>
                          <span className={`mono-data ${r.gapPct >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                            {r.gapPct >= 0 ? "✓ met" : `↑ ${formatPct(Math.abs(r.gapPct), false)} needed`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── ROW 2: BTC Health (full width) ──────────────────────────────────── */}
        <div className="panel p-5">
          <SectionHeader icon={<Activity size={14} />} title="BTC Health" subtitle="Price, 30-day drawdown, MA levels" />
          {loading && !btcAsset ? (
            <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          ) : btcAsset ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Price */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">BTC Price</p>
                <AnimatedNumber value={formatPrice(btcPrice)} className="text-2xl font-bold text-white data-number" />
                <p className={`text-xs mono-data mt-1 ${btcAsset.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {formatPct(btcAsset.change24h)} 24h
                </p>
              </div>
              {/* 30d high & drawdown */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">30-Day High</p>
                <p className="text-xl font-bold mono-data text-foreground">{formatPrice(btcHigh30)}</p>
                <p className={`text-xs mono-data mt-1 ${drawdownClass(btcDrawdownPct)}`}>
                  {formatPct(btcDrawdownPct, false)} from high
                </p>
              </div>
              {/* MA200 */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">200-Day MA</p>
                <p className="text-xl font-bold mono-data text-foreground">{formatPrice(btcAsset.ma200)}</p>
                <p className={`text-xs mono-data mt-1 ${btcPrice > btcAsset.ma200 ? "text-emerald-400" : "text-red-400"}`}>
                  BTC {btcPrice > btcAsset.ma200 ? "ABOVE" : "BELOW"} MA200
                </p>
              </div>
              {/* 90d MA (STH proxy) */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">90-Day MA (STH Proxy)</p>
                <p className="text-xl font-bold mono-data text-foreground">{formatPrice(btcAsset.ma90)}</p>
                <p className="text-xs mono-data mt-1 text-muted-foreground">
                  Ratio: <span className={confidence.sthRatio > 1.08 ? "text-emerald-400" : confidence.sthRatio > 0.97 ? "text-amber-400" : "text-red-400"}>{confidence.sthRatio.toFixed(3)}</span>
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── ROW 3: Market Regime + Confidence v3 ────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* MARKET REGIME */}
          <div className="panel p-5">
            <SectionHeader icon={<Shield size={14} />} title="Market Regime" subtitle="5-state regime from BTC trend + momentum breadth" />
            {loading ? (
              <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-3/4" /></div>
            ) : (
              <div className="space-y-4">
                {/* Current regime */}
                <div className={`p-4 rounded-lg border ${REGIME_BORDER[regime.regime]}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Current Regime</p>
                      <p className={`text-2xl font-bold ${REGIME_COLORS[regime.regime]}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {REGIME_LABELS[regime.regime]}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground mb-1">Composite Score</p>
                      <p className="text-2xl font-bold mono-data text-foreground">{regime.compositeScore.toFixed(3)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 text-sm">
                    <span className="text-muted-foreground">Allocation</span>
                    <span className={`font-bold mono-data ${REGIME_COLORS[regime.regime]}`}>{(regime.allocation * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-sm">
                    <span className="text-muted-foreground">Entry Threshold</span>
                    <span className="font-bold mono-data text-foreground">{regime.entryThreshold.toFixed(1)}</span>
                  </div>
                </div>

                {/* Regime scale */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Regime Scale (composite score)</p>
                  <div className="space-y-1.5">
                    {(["STRONG_INVEST", "INVEST", "NEUTRAL", "CASH", "STRONG_CASH"] as RegimeType[]).map(r => (
                      <div key={r} className={`flex items-center justify-between text-xs p-2 rounded ${r === regime.regime ? REGIME_BORDER[r] + " border" : "opacity-40"}`}>
                        <span className={REGIME_COLORS[r]}>{REGIME_LABELS[r]}</span>
                        <span className="mono-data text-muted-foreground">{(REGIME_ALLOCATION[r] * 100).toFixed(0)}% · threshold {ADAPTIVE_THRESHOLDS[r]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CONFIDENCE SCORE V3 */}
          <div className="panel p-5">
            <SectionHeader icon={<Gauge size={14} />} title="Confidence Score v3" subtitle="F&G 55% + STH Proxy 45% → Leverage Gate at ≥0.68" />
            {loading ? (
              <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-3/4" /></div>
            ) : (
              <div className="space-y-4">
                {/* Score */}
                <div className={`p-4 rounded-lg border ${confidence.leverageFiring ? "border-amber-500/30 bg-amber-500/8" : "border-border/20 bg-card/30"}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Confidence v3 Score</p>
                      <p className={`text-3xl font-bold ${CONFIDENCE_ZONE_COLORS[confidence.zone]}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {confidence.score.toFixed(3)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground mb-1">Zone</p>
                      <p className={`text-lg font-bold ${CONFIDENCE_ZONE_COLORS[confidence.zone]}`}>{confidence.zone}</p>
                    </div>
                  </div>
                  <ConfidenceBar score={confidence.score} zone={confidence.zone} />
                  <div className="flex justify-between text-xs mt-1.5 text-muted-foreground/50">
                    <span>0 — LOW</span>
                    <span className="text-amber-400/70">0.68 leverage gate</span>
                    <span>1 — HIGH</span>
                  </div>
                </div>

                {/* Components */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Fear & Greed Index (55%)</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded border font-semibold mono-data ${confidence.fngValue >= 55 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : confidence.fngValue >= 40 ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-red-400 border-red-500/30 bg-red-500/10"}`}>
                        {confidence.fngValue}
                      </span>
                      <span className="text-xs text-muted-foreground/60 mono-data">30d avg: {confidence.fng30dAvg.toFixed(0)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">STH Proxy — BTC/90d MA (45%)</span>
                    <span className={`font-semibold mono-data ${confidence.sthRatio > 1.08 ? "text-emerald-400" : confidence.sthRatio > 0.97 ? "text-amber-400" : "text-red-400"}`}>
                      {confidence.sthRatio.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">BTC above 200d MA</span>
                    <span className={`flex items-center gap-1 font-semibold ${confidence.btcAbove200 ? "text-emerald-400" : "text-red-400"}`}>
                      {confidence.btcAbove200 ? <><CheckCircle size={12} /> YES</> : <><XCircle size={12} /> NO</>}
                    </span>
                  </div>
                </div>

                {/* Leverage gate */}
                <div className={`p-3 rounded-lg border ${confidence.leverageFiring ? "border-amber-500/30 bg-amber-500/8" : "border-border/20"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">2x Leverage Gate ({LEVERAGE_CONFIDENCE_THRESHOLD}+ AND BTC {'>'} MA200)</span>
                    <span className={`text-xs font-bold ${confidence.leverageFiring ? "text-amber-300" : "text-muted-foreground"}`}>
                      {confidence.leverageFiring ? "🔥 FIRING" : "OFF"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── ROW 4: Momentum Scores + Decision Flow ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* MOMENTUM SCORES */}
          <div className="panel p-5">
            <SectionHeader icon={<BarChart2 size={14} />} title="14-Day Pairwise Momentum" subtitle="Ranked by risk-adjusted score (pairwise × vol ratio)" />
            {loading && !rankedAssets.length ? (
              <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : (
              <div className="space-y-2">
                {rankedAssets.map(({ symbol, riskAdjScore, rank }) => {
                  const m = assets[symbol];
                  const isTarget = signal ? symbol in signal.targetPositions : false;
                  const maxScore = rankedAssets[0]?.riskAdjScore ?? 1;
                  const barWidth = maxScore > 0 ? (Math.abs(riskAdjScore) / maxScore) * 100 : 0;
                  const isPositive = riskAdjScore >= 0;

                  return (
                    <div key={symbol} className={`relative p-3 rounded-lg border transition-all duration-300 ${isTarget ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/30 hover:border-border/60"}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground/60 w-4 text-center font-mono">{rank}</span>
                        <span className="text-xl w-8 text-center" style={{ color: ASSET_COLORS[symbol] }}>{ASSET_ICONS[symbol] ?? symbol}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>{symbol}</span>
                              {isTarget && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">TARGET</span>}
                              {rank === 1 && !isTarget && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-semibold">BEST</span>}
                            </div>
                            <div className="flex items-center gap-3">
                              {m && <span className="text-xs text-muted-foreground mono-data">{formatPrice(m.price)}</span>}
                              <AnimatedNumber value={riskAdjScore.toFixed(1)} className={`text-sm font-bold mono-data ${momentumClass(riskAdjScore)}`} />
                            </div>
                          </div>
                          <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 6%)" }}>
                            <div className="absolute top-0 h-full rounded-full transition-all duration-700" style={{ width: `${barWidth}%`, left: isPositive ? "0" : undefined, right: isPositive ? undefined : "0", background: isPositive ? "oklch(0.72 0.18 155)" : "oklch(0.62 0.22 25)" }} />
                          </div>
                        </div>
                        {m && (
                          <div className="flex flex-col items-center gap-0.5 shrink-0">
                            <span className={`text-xs ${m.nearHigh30 ? "text-emerald-400" : "text-muted-foreground/40"}`}>{m.nearHigh30 ? <TrendingUp size={12} /> : <Minus size={12} />}</span>
                            <span className="text-muted-foreground/40" style={{ fontSize: "9px" }}>HIGH</span>
                          </div>
                        )}
                      </div>
                      {m && (
                        <div className="flex items-center gap-4 mt-2 pl-11">
                          <span className="text-xs text-muted-foreground/60 mono-data">14d: <span className={momentumClass(m.momentum14)}>{formatPct(m.momentum14)}</span></span>
                          <span className="text-xs text-muted-foreground/60 mono-data">Vol↑/↓: <span className="text-foreground/60">{m.volRatio.toFixed(2)}</span></span>
                          <span className="text-xs text-muted-foreground/60 mono-data">DD: <span className={drawdownClass(m.drawdownFromHigh30)}>{formatPct(m.drawdownFromHigh30, false)}</span></span>
                          <span className={`text-xs mono-data ${m.change24h >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>24h: {formatPct(m.change24h)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* DECISION FLOW */}
          <div className="panel p-5">
            <SectionHeader icon={<Target size={14} />} title="Decision Flow" subtitle="Rules evaluated in order — daily candle close only" />
            {loading && !signal ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : signal ? (
              <div className="space-y-2">
                {/* Rule 1: Regime check */}
                {(() => {
                  const cashRegime = regime.regime === "CASH" || regime.regime === "STRONG_CASH";
                  const neutralRegime = regime.regime === "NEUTRAL";
                  const investRegime = !cashRegime && !neutralRegime;
                  return (
                    <>
                      <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${cashRegime ? "border-red-500/40 bg-red-500/8" : "border-emerald-500/20 bg-emerald-500/5"}`}>
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${cashRegime ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {cashRegime ? "!" : "✓"}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground/90" style={{ fontFamily: "Geist, sans-serif" }}>Market Regime</span>
                            {cashRegime && <span className="text-xs text-red-400 font-mono">TRIGGERED</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 mono-data">Regime: {REGIME_LABELS[regime.regime]} (score: {regime.compositeScore.toFixed(3)}, alloc: {(regime.allocation * 100).toFixed(0)}%)</p>
                          {cashRegime && <p className="text-xs text-red-300 mt-1 font-medium">→ SELL ALL — cash regime, 0% allocation</p>}
                        </div>
                      </div>

                      <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${!cashRegime && signal.action === "HOLD" && signal.allocationMode === "CASH" ? "border-amber-500/40 bg-amber-500/8" : cashRegime ? "border-border/20 opacity-40" : "border-emerald-500/20 bg-emerald-500/5"}`}>
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${!cashRegime && signal.action === "HOLD" && signal.allocationMode === "CASH" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {!cashRegime && signal.action === "HOLD" && signal.allocationMode === "CASH" ? "!" : cashRegime ? "2" : "✓"}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground/90" style={{ fontFamily: "Geist, sans-serif" }}>Threshold Check</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                            Top score: {rankedAssets[0]?.riskAdjScore.toFixed(1) ?? "—"} vs threshold {regime.entryThreshold} ({regime.regime})
                          </p>
                          {!cashRegime && signal.action === "HOLD" && signal.allocationMode === "CASH" && (
                            <p className="text-xs text-amber-300 mt-1 font-medium">→ No asset meets threshold — HOLD cash</p>
                          )}
                        </div>
                      </div>

                      <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${signal.action === "BUY" && signal.allocationMode === "REMAINDER_SPLIT" ? "border-emerald-500/30 bg-emerald-500/5" : signal.action === "BUY" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/20 opacity-40"}`}>
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${signal.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {signal.action === "BUY" ? "✓" : "3"}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs font-semibold text-foreground/90" style={{ fontFamily: "Geist, sans-serif" }}>Asset Selection</span>
                          <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                            Top: {rankedAssets[0]?.symbol ?? "—"} (score {rankedAssets[0]?.riskAdjScore.toFixed(1) ?? "—"})
                            {signal.allocationMode === "REMAINDER_SPLIT" ? ` + ${Object.keys(signal.targetPositions)[1]} remainder split` : ""}
                          </p>
                          {signal.action === "BUY" && <p className="text-xs text-emerald-300 mt-1 font-medium">→ {signal.reason}</p>}
                        </div>
                      </div>

                      <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${signal.leverage > 1 ? "border-amber-500/40 bg-amber-500/8" : "border-border/20 opacity-40"}`}>
                        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${signal.leverage > 1 ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                          {signal.leverage > 1 ? "⚡" : "4"}
                        </div>
                        <div className="flex-1">
                          <span className="text-xs font-semibold text-foreground/90" style={{ fontFamily: "Geist, sans-serif" }}>Leverage Gate</span>
                          <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                            Confidence v3 {confidence.score.toFixed(3)} {confidence.score >= LEVERAGE_CONFIDENCE_THRESHOLD ? "≥" : "<"} {LEVERAGE_CONFIDENCE_THRESHOLD} · BTC {confidence.btcAbove200 ? ">" : "<"} MA200
                          </p>
                          {signal.leverage > 1 && <p className="text-xs text-amber-300 mt-1 font-medium">→ 2x leverage applied</p>}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Active rule summary */}
                <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <p className="text-xs text-muted-foreground mb-1">Active Signal</p>
                  <p className="text-sm font-semibold text-foreground mono-data">{signal.action} · {signal.allocationMode}</p>
                  <p className="text-xs text-muted-foreground mt-1">{signal.reason}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── BTC 30-day chart ─────────────────────────────────────────────────── */}
        {btcCandles.length >= 30 && (
          <div className="panel p-5">
            <SectionHeader icon={<Activity size={14} />} title="BTC 30-Day Price History" subtitle="Daily close prices from Binance" />
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={btcCandles.slice(-30).map(c => ({ date: c.date.slice(5), price: c.close }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "oklch(0.55 0.010 260)", fontSize: 10 }} tickLine={false} axisLine={false} width={60} tickFormatter={v => formatPrice(v)} />
                {btcHigh30 > 0 && <ReferenceLine y={btcHigh30} stroke="oklch(0.78 0.18 75)" strokeDasharray="4 2" strokeOpacity={0.6} />}
                {btc14dAgo > 0 && !reentryMet && <ReferenceLine y={btc14dAgo} stroke="oklch(0.60 0.22 255)" strokeDasharray="3 3" strokeOpacity={0.5} />}
                <Line type="monotone" dataKey="price" stroke="oklch(0.78 0.18 75)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "oklch(0.78 0.18 75)" }} />
                <Tooltip contentStyle={{ background: "oklch(0.13 0.012 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 6, fontSize: 11 }} formatter={(v: number) => [formatPrice(v), "BTC Close"]} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground/60">
              <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.78 0.18 75 / 60%)", borderTop: "1px dashed" }} /> 30d High: <span className="text-amber-300 font-semibold mono-data">{formatPrice(btcHigh30)}</span></span>
              {!reentryMet && btc14dAgo > 0 && <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.60 0.22 255 / 50%)", borderTop: "1px dashed" }} /> Re-entry: <span className="text-primary/80 mono-data">{formatPrice(btc14dAgo)}</span></span>}
            </div>
          </div>
        )}

        {/* ── Per-Asset Detail Cards ───────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-primary opacity-70" />
            <h2 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground" style={{ fontFamily: "Geist, sans-serif" }}>Per-Asset Detail</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {MAJORS.map(asset => {
              const m = assets[asset];
              const isTarget = signal ? asset in signal.targetPositions : false;
              const ranked = rankedAssets.find(r => r.symbol === asset);
              const candles = rawData[asset] ?? [];

              return (
                <div key={asset} className={`panel p-4 flex flex-col gap-3 transition-all duration-300 ${isTarget ? "glow-buy" : ""}`} style={isTarget ? { borderColor: "oklch(0.72 0.18 155 / 30%)" } : {}}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" style={{ color: ASSET_COLORS[asset] }}>{ASSET_ICONS[asset]}</span>
                      <div>
                        <p className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>{asset}</p>
                        <p className="text-xs text-muted-foreground/50">#{ranked?.rank ?? "—"}</p>
                      </div>
                    </div>
                    {isTarget && <CheckCircle size={14} className="text-emerald-400" />}
                  </div>

                  {loading && !m ? (
                    <div className="space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-3 w-3/4" /></div>
                  ) : m ? (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">Price</p>
                        <p className="text-base font-bold mono-data text-foreground">{formatPrice(m.price)}</p>
                        <p className={`text-xs mono-data ${m.change24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatPct(m.change24h)} 24h</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">14d Momentum</p>
                        <p className={`text-lg font-bold mono-data ${momentumClass(m.momentum14)}`} style={{ fontFamily: "Syne, sans-serif" }}>{formatPct(m.momentum14)}</p>
                        <p className="text-xs text-muted-foreground/50 mono-data">score: {ranked?.riskAdjScore.toFixed(1) ?? "—"}</p>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-muted-foreground/60">DD from 30d</span>
                          <span className={`mono-data ${drawdownClass(m.drawdownFromHigh30)}`}>{formatPct(m.drawdownFromHigh30, false)}</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(Math.abs(m.drawdownFromHigh30) / 50 * 100, 100)}%`, background: drawdownClass(m.drawdownFromHigh30).includes("emerald") ? "oklch(0.72 0.18 155)" : drawdownClass(m.drawdownFromHigh30).includes("amber") ? "oklch(0.78 0.18 75)" : "oklch(0.62 0.22 25)" }} />
                        </div>
                      </div>
                      {candles.length >= 14 && (
                        <div className="-mx-1">
                          <Sparkline candles={candles} color={ASSET_COLORS[asset]} />
                        </div>
                      )}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground/60">Near 30d High</span>
                        <span className={m.nearHigh30 ? "text-emerald-400" : "text-muted-foreground/40"}>{m.nearHigh30 ? "✓ Yes" : "✗ No"}</span>
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
            <p>The Financial Revolution · Unified Momentum v7.0 · TFR Investing Engine</p>
            <p className="mono-data">
              {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : "Fetching live data..."}
              {" · "}Refreshes every 5 min · Executes 00:05 UTC
            </p>
          </div>
          <p className="text-xs text-muted-foreground/30 mt-2 text-center">
            For informational purposes only. Not financial advice. Strategy: 14-day pairwise momentum · 5-regime market regime · Confidence Score v3 leverage gate.
          </p>
        </footer>

      </div>
    </div>
  );
}
