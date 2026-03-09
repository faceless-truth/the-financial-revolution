/*
 * The Financial Revolution — Strategy Dashboard
 * Design: Dark Precision — deep navy panels, luminous data, colour-coded signals
 * Fonts: Syne (display/numbers) + Geist (labels) + JetBrains Mono (data)
 * Strategy: TREND_CONFIRM v7.0 Conservative — 30-day momentum, 4-rule decision flow, leverage disabled
 */

import {
  useBinanceData,
  type Candle,
  MAJORS,
  PER_ASSET_CAPS,
  CASH_PARTIAL_THRESHOLD,
  CASH_FULL_THRESHOLD,
  MIN_HOLD_DAYS,
  BTC_NEW_HIGH_DAYS,
  BREAKOUT_THRESHOLD,
  CONF_ZONE_HIGH,
} from "@/hooks/useBinanceData";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import {
  formatPrice,
  formatPct,
  timeAgo,
} from "@/lib/formatters";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, TrendingUp, Minus, AlertTriangle, CheckCircle, XCircle, Zap, Target, BarChart2, Activity, Gauge, Bell, BellOff, BookOpen } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { TradeEntryModal } from "@/components/TradeEntryModal";
import { TradeLogPanel } from "@/components/TradeLogPanel";

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

const CONFIDENCE_ZONE_COLORS: Record<string, string> = {
  HIGH: "text-emerald-300",
  "MEDIUM-HIGH": "text-emerald-400",
  MEDIUM: "text-amber-400",
  "MEDIUM-LOW": "text-orange-400",
  LOW: "text-red-400",
};

// ── Signal action display ──────────────────────────────────────────────────────
function signalClass(action: string): string {
  switch (action) {
    case "BUY": return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
    case "SELL_ALL": return "text-red-400 border-red-500/40 bg-red-500/10";
    case "ROTATE": return "text-amber-400 border-amber-500/40 bg-amber-500/10";
    case "REBALANCE": return "text-blue-400 border-blue-500/40 bg-blue-500/10";
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
  const color =
    zone === "HIGH" ? "oklch(0.72 0.18 155)" :
    zone === "MEDIUM-HIGH" ? "oklch(0.72 0.18 155 / 80%)" :
    zone === "MEDIUM" ? "oklch(0.78 0.18 75)" :
    zone === "MEDIUM-LOW" ? "oklch(0.75 0.20 50)" :
    "oklch(0.62 0.22 25)";
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score * 100}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function Home() {
  const { signal, assets, rankedAssets, btcHealth, confidence, rawData, reentryTable, loading, error, lastUpdated } = useBinanceData(5 * 60 * 1000);
  const [, setTick] = useState(0);
  const { status: notifStatus, isSubscribed, storedSignal, subscribe, unsubscribe, reportSignalChange } = usePushNotifications();
  const prevSignalRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Detect signal changes and notify backend
  useEffect(() => {
    if (!signal) return;
    const currentAction = signal.action;
    // Compare with stored backend signal (source of truth for notifications)
    if (storedSignal && storedSignal.action !== currentAction) {
      reportSignalChange(currentAction, signal.ruleTriggered ?? null, signal.reason);
    } else if (!storedSignal && prevSignalRef.current && prevSignalRef.current !== currentAction) {
      reportSignalChange(currentAction, signal.ruleTriggered ?? null, signal.reason);
    }
    prevSignalRef.current = currentAction;
  }, [signal?.action, storedSignal, reportSignalChange]);

  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeModalSignal, setTradeModalSignal] = useState<{ action: string; asset: string; price?: number } | null>(null);

  // Open trade entry modal when a non-HOLD signal fires
  const prevActionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!signal) return;
    const action = signal.action;
    if (prevActionRef.current !== null && prevActionRef.current !== action && action !== "HOLD") {
      const topAsset = Object.keys(signal.targetPositions)[0] ?? "CASH";
      const price = (assets as Record<string, { price: number } | undefined>)[topAsset]?.price;
      setTradeModalSignal({ action, asset: topAsset, price });
      setTradeModalOpen(true);
    }
    prevActionRef.current = action;
  }, [signal?.action]);

  const btcAsset = assets["BTC"];
  const btcPrice = btcHealth.price;
  const btcCandles = rawData["BTC"] ?? [];

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
              <p className="text-xs text-muted-foreground">TREND_CONFIRM v7.0 Conservative · Live Binance Data · Executes 00:05 UTC</p>
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
            {/* Notification bell */}
            {notifStatus !== "unsupported" && (
              <button
                onClick={isSubscribed ? unsubscribe : subscribe}
                title={isSubscribed ? "Disable push notifications" : "Enable push notifications"}
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-border/40 transition-all hover:border-primary/40"
                style={{ background: isSubscribed ? "oklch(0.72 0.18 155 / 15%)" : "oklch(0.13 0.012 260)" }}
              >
                {notifStatus === "loading" ? (
                  <RefreshCw size={14} className="animate-spin text-muted-foreground" />
                ) : isSubscribed ? (
                  <Bell size={14} className="text-emerald-400" />
                ) : (
                  <BellOff size={14} className="text-muted-foreground/50" />
                )}
              </button>
            )}
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
                    <p className="text-xs text-muted-foreground">Rule Triggered</p>
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
                    </div>
                  )}
                </div>

                {/* Leverage (disabled) */}
                <div className="p-3 rounded-lg border border-border/20 bg-card/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">Leverage Gate</span>
                    <span className="text-sm font-bold mono-data text-muted-foreground">1x (disabled)</span>
                  </div>
                  <p className="text-xs text-muted-foreground/60">Leverage disabled in v7.0 Conservative</p>
                </div>

                {/* Log Trade button — always visible in signal panel */}
                <button
                  onClick={() => {
                    const topAsset = Object.keys(signal.targetPositions)[0] ?? "BTC";
                    const price = (assets as Record<string, { price: number } | undefined>)[topAsset]?.price;
                    setTradeModalSignal({ action: signal.action, asset: topAsset, price });
                    setTradeModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border text-xs font-semibold transition-all hover:opacity-80 active:scale-95"
                  style={{
                    borderColor: signal.action === "SELL_ALL" ? "oklch(0.62 0.22 25 / 40%)" : "oklch(0.72 0.18 155 / 40%)",
                    background: signal.action === "SELL_ALL" ? "oklch(0.62 0.22 25 / 10%)" : "oklch(0.72 0.18 155 / 10%)",
                    color: signal.action === "SELL_ALL" ? "oklch(0.62 0.22 25)" : "oklch(0.72 0.18 155)",
                  }}
                >
                  <BookOpen size={13} />
                  Log my {signal.action === "SELL_ALL" ? "sell" : "buy"} price
                </button>
              </div>
            ) : null}
          </div>

          {/* RE-ENTRY TRIGGER — all assets, 2-day rolling */}
          <div className="panel p-5 flex flex-col gap-4">
            <SectionHeader icon={<Target size={14} />} title="Re-Entry Triggers" subtitle="30-day momentum pivot — today & tomorrow for all assets" />
            {loading && !reentryTable.length ? (
              <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (
              <div className="space-y-1">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-2 pb-1 border-b border-border/20">
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wider">Asset</span>
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wider text-right w-20">Now</span>
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wider text-right w-20">Today</span>
                  <span className="text-xs text-muted-foreground/50 uppercase tracking-wider text-right w-20">Tomorrow</span>
                </div>

                {reentryTable.map(row => {
                  if (row.currentPrice === 0) return null;
                  const isHighPrice = row.currentPrice > 100; // BTC/ETH vs SOL/SUI/DOGE
                  const fmt = (v: number) => isHighPrice ? formatPrice(v) : `$${v.toFixed(4)}`;
                  return (
                    <div
                      key={row.symbol}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-2 py-2 rounded-lg transition-colors"
                      style={{ background: row.metToday ? "oklch(0.72 0.18 155 / 6%)" : "transparent" }}
                    >
                      {/* Asset name */}
                      <div className="flex items-center gap-2">
                        <span className="text-base w-5 text-center" style={{ color: ASSET_COLORS[row.symbol] }}>{row.icon}</span>
                        <span className="text-sm font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>{row.symbol}</span>
                        {row.metToday && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-semibold">✓</span>
                        )}
                      </div>

                      {/* Current price */}
                      <div className="text-right w-20">
                        <p className="text-xs font-semibold mono-data text-foreground/80">{fmt(row.currentPrice)}</p>
                      </div>

                      {/* Today's trigger */}
                      <div className="text-right w-20">
                        <p className={`text-xs font-bold mono-data ${row.metToday ? "text-emerald-400" : "text-foreground/70"}`}>
                          {fmt(row.triggerToday)}
                        </p>
                        <p className={`text-xs mono-data ${row.metToday ? "text-emerald-400" : "text-amber-400"}`}>
                          {row.metToday ? "✓ met" : `+${row.gapTodayPct.toFixed(1)}%`}
                        </p>
                      </div>

                      {/* Tomorrow's trigger */}
                      <div className="text-right w-20">
                        <p className={`text-xs font-bold mono-data ${row.metTomorrow ? "text-emerald-400" : "text-foreground/70"}`}>
                          {fmt(row.triggerTomorrow)}
                        </p>
                        <p className={`text-xs mono-data ${row.metTomorrow ? "text-emerald-400" : "text-muted-foreground/50"}`}>
                          {row.metTomorrow ? "✓ met" : `+${row.gapTomorrowPct.toFixed(1)}%`}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Legend */}
                <div className="pt-2 border-t border-border/20 flex flex-wrap gap-3 text-xs text-muted-foreground/50">
                  <span>Trigger = price 30 days ago</span>
                  <span>·</span>
                  <span>Tomorrow = window shifts +1 day at 00:05 UTC</span>
                  <span>·</span>
                  <span className="text-emerald-400/70">✓ = momentum positive, re-entry allowed</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── ROW 2: BTC Health (full width) ──────────────────────────────────── */}
        <div className="panel p-5">
          <SectionHeader icon={<Activity size={14} />} title="BTC Health" subtitle="Price, 30-day drawdown, cash trigger thresholds" />
          {loading && !btcAsset ? (
            <div className="space-y-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          ) : btcAsset ? (
            <div className="space-y-4">
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
                  <p className="text-xl font-bold mono-data text-foreground">{formatPrice(btcHealth.high30d)}</p>
                  <p className={`text-xs mono-data mt-1 ${drawdownClass(-btcHealth.drawdownPct)}`}>
                    {btcHealth.drawdownPct > 0 ? `-${btcHealth.drawdownPct.toFixed(1)}%` : "At high"} from high
                  </p>
                </div>
                {/* Cash trigger status */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Cash Trigger</p>
                  <p className={`text-xl font-bold mono-data ${btcHealth.cashTriggerStatus === "FULL" ? "text-red-400" : btcHealth.cashTriggerStatus === "PARTIAL" ? "text-amber-400" : "text-emerald-400"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                    {btcHealth.cashTriggerStatus}
                  </p>
                  <p className="text-xs mono-data mt-1 text-muted-foreground">
                    {btcHealth.cashTriggerStatus === "NONE" ? `Partial at ${formatPrice(btcHealth.partialTriggerPrice)}` :
                     btcHealth.cashTriggerStatus === "PARTIAL" ? `Full at ${formatPrice(btcHealth.fullTriggerPrice)}` :
                     "Full cash — all sold"}
                  </p>
                </div>
                {/* BTC Rallying */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">BTC Rallying</p>
                  <p className={`text-xl font-bold mono-data ${btcHealth.isRallying ? "text-emerald-400" : "text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                    {btcHealth.isRallying ? "YES" : "NO"}
                  </p>
                  <p className="text-xs mono-data mt-1 text-muted-foreground">
                    New high in last {BTC_NEW_HIGH_DAYS} days
                  </p>
                </div>
              </div>

              {/* Drawdown bar with threshold markers */}
              <div>
                <div className="flex justify-between text-xs text-muted-foreground/60 mb-1">
                  <span>BTC Drawdown from 30d High</span>
                  <span className={`font-semibold mono-data ${drawdownClass(-btcHealth.drawdownPct)}`}>
                    {btcHealth.drawdownPct > 0 ? `-${btcHealth.drawdownPct.toFixed(1)}%` : "0%"}
                  </span>
                </div>
                <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(btcHealth.drawdownPct / 30 * 100, 100)}%`,
                      background: btcHealth.cashTriggerStatus === "FULL" ? "oklch(0.62 0.22 25)" :
                                  btcHealth.cashTriggerStatus === "PARTIAL" ? "oklch(0.78 0.18 75)" :
                                  "oklch(0.72 0.18 155)",
                    }}
                  />
                  {/* Partial trigger marker at 12% */}
                  <div className="absolute top-0 bottom-0 w-px bg-amber-400/60" style={{ left: `${CASH_PARTIAL_THRESHOLD / 0.30 * 100}%` }} />
                  {/* Full trigger marker at 25% */}
                  <div className="absolute top-0 bottom-0 w-px bg-red-400/60" style={{ left: `${CASH_FULL_THRESHOLD / 0.30 * 100}%` }} />
                </div>
                <div className="flex justify-between text-xs mt-1 text-muted-foreground/40">
                  <span>0%</span>
                  <span className="text-amber-400/60">{(CASH_PARTIAL_THRESHOLD * 100).toFixed(0)}% partial</span>
                  <span className="text-red-400/60">{(CASH_FULL_THRESHOLD * 100).toFixed(0)}% full</span>
                  <span>30%</span>
                </div>
              </div>

              {/* MA levels */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg border border-border/20 bg-card/30">
                  <p className="text-xs text-muted-foreground mb-1">200-Day MA</p>
                  <p className="text-sm font-bold mono-data text-foreground">{formatPrice(btcAsset.ma200)}</p>
                  <p className={`text-xs mono-data mt-0.5 ${confidence.btcAbove200 ? "text-emerald-400" : "text-red-400"}`}>
                    BTC {confidence.btcAbove200 ? "ABOVE" : "BELOW"} MA200
                  </p>
                </div>
                <div className="p-2.5 rounded-lg border border-border/20 bg-card/30">
                  <p className="text-xs text-muted-foreground mb-1">90-Day MA (STH Proxy)</p>
                  <p className="text-sm font-bold mono-data text-foreground">{formatPrice(btcAsset.ma90)}</p>
                  <p className="text-xs mono-data mt-0.5 text-muted-foreground">
                    Ratio: <span className={confidence.sthRatio > 1.08 ? "text-emerald-400" : confidence.sthRatio > 0.97 ? "text-amber-400" : "text-red-400"}>{confidence.sthRatio.toFixed(3)}</span>
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── CASH TRIGGER LEVELS ────────────────────────────────────────────── */}
        {btcHealth.high30d > 0 && (
          <div className="panel p-5">
            <SectionHeader
              icon={<AlertTriangle size={14} />}
              title="Cash Trigger Levels"
              subtitle={`BTC must close below these prices to trigger a forced exit — based on 30d high of ${formatPrice(btcHealth.high30d)}`}
            />
            <div className="space-y-3 mt-1">

              {/* Partial trigger row */}
              {(() => {
                const partialPrice = btcHealth.partialTriggerPrice;
                const fullPrice = btcHealth.fullTriggerPrice;
                const currentPrice = btcHealth.price;
                const partialGap = currentPrice - partialPrice;
                const fullGap = currentPrice - fullPrice;
                const partialTriggered = btcHealth.cashTriggerStatus === "PARTIAL" || btcHealth.cashTriggerStatus === "FULL";
                const fullTriggered = btcHealth.cashTriggerStatus === "FULL";

                return (
                  <>
                    {/* Partial — 50% cash */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      partialTriggered
                        ? "border-amber-500/50 bg-amber-500/10"
                        : "border-border/25 bg-card/30"
                    }`}>
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center ${
                        partialTriggered ? "bg-amber-500/20" : "bg-muted/30"
                      }`}>
                        <span className={`text-xs font-bold ${partialTriggered ? "text-amber-400" : "text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>50%</span>
                        <span className={`text-[9px] ${partialTriggered ? "text-amber-400/70" : "text-muted-foreground/50"}`}>CASH</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-lg font-bold mono-data ${partialTriggered ? "text-amber-400" : "text-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                            {formatPrice(partialPrice)}
                          </span>
                          {partialTriggered ? (
                            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">TRIGGERED</span>
                          ) : (
                            <span className="text-xs text-muted-foreground mono-data">
                              {formatPrice(partialGap)} away
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          BTC 12% below 30d high · Half position sold, 50% moved to cash
                        </p>
                        {/* Gap bar */}
                        {!partialTriggered && (
                          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${Math.min(100, Math.max(0, (1 - partialGap / (btcHealth.high30d - partialPrice)) * 100))}%`,
                                background: "oklch(0.78 0.18 75)",
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">−12% from high</p>
                        <p className={`text-sm font-bold mono-data mt-0.5 ${partialTriggered ? "text-amber-400" : "text-muted-foreground/60"}`}>
                          {partialTriggered ? "ACTIVE" : `${((partialGap / currentPrice) * 100).toFixed(1)}% buffer`}
                        </p>
                      </div>
                    </div>

                    {/* Full — 100% cash */}
                    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      fullTriggered
                        ? "border-red-500/50 bg-red-500/10"
                        : "border-border/25 bg-card/30"
                    }`}>
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center ${
                        fullTriggered ? "bg-red-500/20" : "bg-muted/30"
                      }`}>
                        <span className={`text-xs font-bold ${fullTriggered ? "text-red-400" : "text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>100%</span>
                        <span className={`text-[9px] ${fullTriggered ? "text-red-400/70" : "text-muted-foreground/50"}`}>CASH</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-lg font-bold mono-data ${fullTriggered ? "text-red-400" : "text-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                            {formatPrice(fullPrice)}
                          </span>
                          {fullTriggered ? (
                            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">TRIGGERED</span>
                          ) : (
                            <span className="text-xs text-muted-foreground mono-data">
                              {formatPrice(fullGap)} away
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          BTC 25% below 30d high · Full exit — 100% moved to cash, overrides hold period
                        </p>
                        {/* Gap bar */}
                        {!fullTriggered && (
                          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "oklch(1 0 0 / 8%)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${Math.min(100, Math.max(0, (1 - fullGap / (btcHealth.high30d - fullPrice)) * 100))}%`,
                                background: "oklch(0.62 0.22 25)",
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">−25% from high</p>
                        <p className={`text-sm font-bold mono-data mt-0.5 ${fullTriggered ? "text-red-400" : "text-muted-foreground/60"}`}>
                          {fullTriggered ? "ACTIVE" : `${((fullGap / currentPrice) * 100).toFixed(1)}% buffer`}
                        </p>
                      </div>
                    </div>

                    {/* Summary note */}
                    <p className="text-xs text-muted-foreground/50 text-center pt-1">
                      30d high resets daily · triggers recalculate each candle close at 00:05 UTC
                    </p>
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── ROW 3: Confidence v3 ─────────────────────────────────────────────── */}
        <div className="panel p-5">
          <SectionHeader icon={<Gauge size={14} />} title="Confidence Score v3" subtitle="F&G 55% + STH Proxy (BTC / 90d MA) 45% — leverage gate disabled in v7.0 Conservative" />
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-3/4" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Score */}
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-border/20 bg-card/30">
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
                    <span className="text-muted-foreground/40">{CONF_ZONE_HIGH} leverage gate (disabled)</span>
                    <span>1 — HIGH</span>
                  </div>
                </div>
              </div>

              {/* Components */}
              <div className="space-y-3">
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
                <div className="p-3 rounded-lg border border-border/20 bg-card/20 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">2x Leverage Gate (≥{CONF_ZONE_HIGH} AND BTC &gt; MA200)</span>
                    <span className="text-xs font-bold text-muted-foreground/50">DISABLED</span>
                  </div>
                  <p className="text-xs text-muted-foreground/40 mt-1">Leverage disabled in v7.0 Conservative — always 1x</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ROW 4: Momentum Scores + Decision Flow ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* MOMENTUM SCORES */}
          <div className="panel p-5">
            <SectionHeader icon={<BarChart2 size={14} />} title="30-Day Momentum Scores" subtitle="Ranked by direct 30-day % return — best score wins" />
            {loading && !rankedAssets.length ? (
              <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : (
              <div className="space-y-2">
                {rankedAssets.map(({ symbol, score, rank }) => {
                  const m = assets[symbol];
                  const isTarget = signal ? symbol in signal.targetPositions : false;
                  const maxScore = Math.max(...rankedAssets.map(r => Math.abs(r.score)), 1);
                  const barWidth = (Math.abs(score) / maxScore) * 100;
                  const isPositive = score >= 0;

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
                              <AnimatedNumber value={`${score >= 0 ? "+" : ""}${score.toFixed(1)}%`} className={`text-sm font-bold mono-data ${momentumClass(score)}`} />
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
                          <span className="text-xs text-muted-foreground/60 mono-data">DD: <span className={drawdownClass(m.drawdownFromHigh30)}>{formatPct(m.drawdownFromHigh30, false)}</span></span>
                          <span className={`text-xs mono-data ${m.change24h >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>24h: {formatPct(m.change24h)}</span>
                          <span className={`text-xs mono-data ${m.nearHigh30 ? "text-emerald-400/70" : "text-muted-foreground/40"}`}>
                            {m.nearHigh30 ? "✓ near high" : `↑ ${formatPct(Math.abs(m.drawdownFromHigh30), false)} to breakout`}
                          </span>
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
            <SectionHeader icon={<Target size={14} />} title="Decision Flow" subtitle="4 rules evaluated in order — daily candle close only" />
            {loading && !signal ? (
              <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : signal ? (
              <div className="space-y-2">

                {/* Rule 1: Cash trigger */}
                {(() => {
                  const triggered = signal.ruleTriggered === "CASH_FULL" || signal.ruleTriggered === "CASH_PARTIAL";
                  const isActive = btcHealth.cashTriggerStatus !== "NONE";
                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${triggered ? "border-red-500/40 bg-red-500/8" : isActive ? "border-amber-500/30 bg-amber-500/8" : "border-emerald-500/20 bg-emerald-500/5"}`}>
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${triggered ? "bg-red-500/20 text-red-400" : isActive ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {triggered ? "!" : isActive ? "~" : "✓"}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground/90">Rule 1 — Cash Trigger</span>
                          {triggered && <span className="text-xs text-red-400 font-mono">TRIGGERED</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                          BTC drawdown: {btcHealth.drawdownPct.toFixed(1)}% · Partial at {(CASH_PARTIAL_THRESHOLD * 100).toFixed(0)}% · Full at {(CASH_FULL_THRESHOLD * 100).toFixed(0)}%
                        </p>
                        {triggered && <p className="text-xs text-red-300 mt-1 font-medium">→ {signal.reason}</p>}
                        {isActive && !triggered && <p className="text-xs text-amber-300 mt-1 font-medium">→ PARTIAL cash — 50% allocation</p>}
                      </div>
                    </div>
                  );
                })()}

                {/* Rule 2: Min-hold */}
                {(() => {
                  const triggered = signal.ruleTriggered === "MIN_HOLD";
                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${triggered ? "border-amber-500/40 bg-amber-500/8" : "border-border/20 bg-card/20"}`}>
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${triggered ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {triggered ? "!" : "2"}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground/90">Rule 2 — Min-Hold Period</span>
                          {triggered && <span className="text-xs text-amber-400 font-mono">BLOCKED</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                          {triggered ? `Held ${signal.daysHeld}/${MIN_HOLD_DAYS} days — rotation blocked` : `Min hold: ${MIN_HOLD_DAYS} days`}
                        </p>
                        {triggered && <p className="text-xs text-amber-300 mt-1 font-medium">→ {signal.reason}</p>}
                      </div>
                    </div>
                  );
                })()}

                {/* Rule 3: BTC rally */}
                {(() => {
                  const triggered = signal.ruleTriggered === "BTC_RALLY";
                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${triggered ? "border-amber-500/40 bg-amber-500/8" : btcHealth.isRallying ? "border-amber-500/20 bg-amber-500/5" : "border-border/20 bg-card/20"}`}>
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${triggered ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {triggered ? "!" : "3"}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground/90">Rule 3 — BTC Rally Block</span>
                          {triggered && <span className="text-xs text-amber-400 font-mono">BLOCKED</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                          BTC rallying (new high in last {BTC_NEW_HIGH_DAYS}d): {btcHealth.isRallying ? "YES — alts blocked" : "NO — alts allowed"}
                        </p>
                        {triggered && <p className="text-xs text-amber-300 mt-1 font-medium">→ {signal.reason}</p>}
                      </div>
                    </div>
                  );
                })()}

                {/* Rule 4: Breakout check */}
                {(() => {
                  const triggered = signal.ruleTriggered === "NO_BREAKOUT";
                  const bestAsset = rankedAssets[0];
                  const bestMetric = bestAsset ? assets[bestAsset.symbol] : null;
                  return (
                    <div className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${triggered ? "border-amber-500/40 bg-amber-500/8" : "border-border/20 bg-card/20"}`}>
                      <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${triggered ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`} style={{ fontFamily: "Syne, sans-serif" }}>
                        {triggered ? "!" : "4"}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground/90">Rule 4 — Breakout Check</span>
                          {triggered && <span className="text-xs text-amber-400 font-mono">BLOCKED</span>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 mono-data">
                          {bestAsset ? `${bestAsset.symbol} within ${(BREAKOUT_THRESHOLD * 100).toFixed(0)}% of 30d high: ${bestMetric?.nearHigh30 ? "YES ✓" : "NO ✗"}` : "No asset data"}
                        </p>
                        {triggered && <p className="text-xs text-amber-300 mt-1 font-medium">→ {signal.reason}</p>}
                      </div>
                    </div>
                  );
                })()}

                {/* Active rule summary */}
                <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <p className="text-xs text-muted-foreground mb-1">Active Signal</p>
                  <p className="text-sm font-semibold text-foreground mono-data">{signal.action} · {signal.ruleTriggered || "HOLD"}</p>
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
                {btcHealth.high30d > 0 && <ReferenceLine y={btcHealth.high30d} stroke="oklch(0.78 0.18 75)" strokeDasharray="4 2" strokeOpacity={0.6} />}
                {btcHealth.partialTriggerPrice > 0 && <ReferenceLine y={btcHealth.partialTriggerPrice} stroke="oklch(0.78 0.18 75 / 50%)" strokeDasharray="3 3" strokeOpacity={0.5} />}
                {btcHealth.fullTriggerPrice > 0 && <ReferenceLine y={btcHealth.fullTriggerPrice} stroke="oklch(0.62 0.22 25 / 60%)" strokeDasharray="3 3" strokeOpacity={0.5} />}
                {signal && !signal.reentryAlreadyMet && signal.reentryTriggerPrice > 0 && (
                  <ReferenceLine y={signal.reentryTriggerPrice} stroke="oklch(0.60 0.22 255)" strokeDasharray="3 3" strokeOpacity={0.5} />
                )}
                <Line type="monotone" dataKey="price" stroke="oklch(0.78 0.18 75)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "oklch(0.78 0.18 75)" }} />
                <Tooltip contentStyle={{ background: "oklch(0.13 0.012 260)", border: "1px solid oklch(1 0 0 / 10%)", borderRadius: 6, fontSize: 11 }} formatter={(v: number) => [formatPrice(v), "BTC Close"]} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground/60">
              <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.78 0.18 75 / 60%)", borderTop: "1px dashed" }} /> 30d High: <span className="text-amber-300 font-semibold mono-data">{formatPrice(btcHealth.high30d)}</span></span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.78 0.18 75 / 40%)", borderTop: "1px dashed" }} /> Partial trigger: <span className="text-amber-400/70 mono-data">{formatPrice(btcHealth.partialTriggerPrice)}</span></span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.62 0.22 25 / 50%)", borderTop: "1px dashed" }} /> Full trigger: <span className="text-red-400/70 mono-data">{formatPrice(btcHealth.fullTriggerPrice)}</span></span>
              {signal && !signal.reentryAlreadyMet && signal.reentryTriggerPrice > 0 && (
                <span className="flex items-center gap-1.5"><span className="w-4 h-px inline-block" style={{ background: "oklch(0.60 0.22 255 / 50%)", borderTop: "1px dashed" }} /> Re-entry: <span className="text-primary/80 mono-data">{formatPrice(signal.reentryTriggerPrice)}</span></span>
              )}
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
                        <p className="text-xs text-muted-foreground">30d Momentum</p>
                        <p className={`text-lg font-bold mono-data ${momentumClass(m.momentum30)}`} style={{ fontFamily: "Syne, sans-serif" }}>{formatPct(m.momentum30)}</p>
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

        {/* ── Trade Log ───────────────────────────────────────────────────────── */}
        <TradeLogPanel />

        {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
        <footer className="border-t border-border/20 pt-4 pb-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground/50">
            <p>The Financial Revolution · TREND_CONFIRM v7.0 Conservative · TFR Investing Engine</p>
            <p className="mono-data">
              {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : "Fetching live data..."}
              {" · "}Refreshes every 5 min · Executes 00:05 UTC
            </p>
          </div>
          <p className="text-xs text-muted-foreground/30 mt-2 text-center">
            For informational purposes only. Not financial advice. Strategy: 30-day momentum · 4-rule decision flow · Confidence Score v3 · Leverage disabled.
          </p>
        </footer>

      </div>

      {/* Trade entry modal — appears when signal changes */}
      {tradeModalSignal && (
        <TradeEntryModal
          isOpen={tradeModalOpen}
          onClose={() => setTradeModalOpen(false)}
          signalAction={tradeModalSignal.action}
          targetAsset={tradeModalSignal.asset}
          estimatedPrice={tradeModalSignal.price}
        />
      )}
    </div>
  );
}
