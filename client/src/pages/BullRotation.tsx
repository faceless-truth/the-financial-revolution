/**
 * Bull Rotation — public strategy dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads /api/bull-rotation (served from the Python-emitted
 * data/public/dashboard_payload.json) and renders:
 *   • Dashboard tab — BTC 7-day closes, current status, entry/exit rules,
 *     and the next-move forecast (when it expects to enter / exit).
 *   • History tab   — the permanent record: Bull Rotation's completed trades,
 *     the 4h scalp tracker's trades, and the full daily decision log both are
 *     derived from (the same decisions that go out over Telegram).
 *   • Learning tab  — how the strategy works + the weekly self-reflection slot.
 *
 * Display-only. Every value comes from the emitted payload; nothing here feeds
 * back into a trade decision.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ── Types (loose — payload is authoritative) ─────────────────────────────────
interface Condition { label: string; detail: string; distance_pct: number | null; }
/** Bull Rotation's permanent trade record — completed round-trips derived from
 *  the daily decisions, plus the position still open. */
interface TradeRecord {
  first_date: string | null;
  last_date: string | null;
  days_recorded: number;
  closed_trades: any[];
  open_trade: any | null;
  cash_periods: any[];
  stats: any;
}
/** The 4h scalp tracker's own record, results in R (risk multiples). */
interface ScalpRecord {
  available: boolean;
  closed_trades: any[];
  open_positions: any[];
  stats: any;
  first_date: string | null;
  last_date: string | null;
}
interface Payload {
  generated_at: string | null;
  as_of_date: string | null;
  strategy_version: string;
  btc_7d: { date: string; close: number }[];
  btc_7d_source: string;
  status: any;
  rules: { entry: string[]; exit: string[] };
  forecast: { mode: string; headline: string; conditions: Condition[]; eta: string };
  params: Record<string, any>;
  history: any[];
  trades: TradeRecord;
  scalp: ScalpRecord;
  learning: any;
  available: boolean;
}

const ASSET_COLORS: Record<string, string> = {
  BTC: "#f7931a", ETH: "#8a92b2", SOL: "#14f195",
  DOGE: "#c2a633", SUI: "#4da2ff", CASH: "#22c55e",
};

const fmtUsd = (v: number, dp = 0) =>
  v == null || !isFinite(v) ? "—" :
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dp }).format(v);
const fmtPct = (v: number | null | undefined, dp = 1) =>
  v == null || !isFinite(v as number) ? "—" : `${(v as number) >= 0 ? "+" : ""}${(v as number).toFixed(dp)}%`;
/** Prices span BTC at ~$63,000 and DOGE at ~$0.07, so scale the precision. */
const fmtPrice = (v: number | null | undefined) => {
  if (v == null || !isFinite(v as number)) return "—";
  const n = v as number;
  const dp = Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 5;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n);
};
/** Scalp results are in R — multiples of the risk taken to the stop. */
const fmtR = (v: number | null | undefined) =>
  v == null || !isFinite(v as number) ? "—" : `${(v as number) >= 0 ? "+" : ""}${(v as number).toFixed(2)}R`;
const pnlClass = (v: number | null | undefined) =>
  v == null || !isFinite(v as number) ? "" : (v as number) >= 0 ? "text-emerald-400" : "text-rose-400";

// How many rows each long table shows before "show all".
const HISTORY_PREVIEW = 30;
const SCALP_PREVIEW = 15;

const EMPTY_TRADES: TradeRecord = {
  first_date: null, last_date: null, days_recorded: 0,
  closed_trades: [], open_trade: null, cash_periods: [], stats: {},
};
const EMPTY_SCALP: ScalpRecord = {
  available: false, closed_trades: [], open_positions: [], stats: {},
  first_date: null, last_date: null,
};

// ── Small presentational helpers ─────────────────────────────────────────────
function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card/60 p-4 md:p-5 ${className}`}>
      {children}
    </div>
  );
}
function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={color ? { color } : undefined}>{value}</div>
      {sub != null && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
    </Card>
  );
}
function DistanceBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
      {fmtPct(pct)}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function BullRotation() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [allHistory, setAllHistory] = useState(false);
  const [allScalp, setAllScalp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/bull-rotation", { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error("Bull Rotation load failed", e);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const s = data?.status ?? {};
  const regime = s.regime ?? {};
  const pos: string = s.position ?? "CASH";
  const posColor = ASSET_COLORS[pos] ?? ASSET_COLORS.CASH;

  const chart = useMemo(
    () => (data?.btc_7d ?? []).map((r) => ({ ...r, label: r.date.slice(5) })),
    [data]
  );
  const ydomain = useMemo(() => {
    const vals = chart.map((c) => c.close);
    if (!vals.length) return [0, 1] as [number, number];
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || hi * 0.01;
    return [Math.floor(lo - pad), Math.ceil(hi + pad)] as [number, number];
  }, [chart]);

  // ── History tab: trade records + the daily log they derive from ────────────
  const trades = data?.trades ?? EMPTY_TRADES;
  const scalp = data?.scalp ?? EMPTY_SCALP;
  const tstats = trades.stats ?? {};
  const sstats = scalp.stats ?? {};
  const history = data?.history ?? [];
  // Most recent first, as the payload emits them.
  const closedTrades = useMemo(
    () => [...(trades.closed_trades ?? [])].reverse(),
    [trades]
  );
  const visibleHistory = allHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const visibleScalp = allScalp
    ? scalp.closed_trades
    : scalp.closed_trades.slice(0, SCALP_PREVIEW);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading strategy…</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-6 md:py-8">

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Bull Rotation</h1>
            <p className="text-sm text-muted-foreground">
              Trend-rotation strategy · <span className="font-medium text-foreground">{data?.strategy_version}</span>
              {data?.as_of_date && <> · as of {data.as_of_date}</>}
            </p>
          </div>
          <Link href="/portfolio" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Detailed portfolio →
          </Link>
        </div>

        {!data?.available && (
          <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
            <p className="text-sm text-amber-400">
              Strategy payload not found yet. It is generated after each daily close.
            </p>
          </Card>
        )}

        <Tabs defaultValue="dashboard">
          <TabsList className="mb-5">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="learning">Learning</TabsTrigger>
          </TabsList>

          {/* ── DASHBOARD ─────────────────────────────────────────────── */}
          <TabsContent value="dashboard" className="space-y-6">

            {/* Status strip */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Position" value={s.position_label ?? pos} color={posColor}
                    sub={s.invested ? `Held ${s.hold_days ?? 0} day(s)` : "Awaiting entry"} />
              <Stat label="Portfolio" value={fmtUsd(s.portfolio_value_usd)}
                    sub={`Reserve ${fmtUsd(s.reserve_usd)}`} />
              <Stat label="Total wealth" value={fmtUsd(s.total_wealth_usd)}
                    sub="Portfolio + reserve" />
              <Stat label="BTC regime"
                    value={<span className={regime.bull_regime ? "text-emerald-400" : "text-rose-400"}>{regime.bull_regime ? "Bullish" : "Bearish"}</span>}
                    sub={`30d mom ${fmtPct(regime.btc_mom_30)} · conf ${regime.regime_conf?.toFixed?.(0) ?? "—"}`} />
            </div>

            {/* Current read */}
            <Card>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Current read</div>
                <div className="text-xs text-muted-foreground">{s.action}</div>
              </div>
              <p className="mt-1 text-base">{s.reason}</p>
            </Card>

            {/* BTC 7-day chart */}
            <Card>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">BTC — last 7 daily closes</h2>
                <span className="text-xs text-muted-foreground">
                  latest {fmtUsd(chart.at(-1)?.close ?? 0)} · source: {data?.btc_7d_source}
                </span>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="btcFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ASSET_COLORS.BTC} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={ASSET_COLORS.BTC} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" opacity={0.25} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="currentColor" className="text-muted-foreground" />
                    <YAxis domain={ydomain} tick={{ fontSize: 12 }} width={64}
                           tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                           stroke="currentColor" className="text-muted-foreground" />
                    <Tooltip
                      formatter={(v: any) => [fmtUsd(Number(v)), "Close"]}
                      contentStyle={{ background: "rgba(20,20,28,0.95)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#aaa" }}
                    />
                    <Area type="monotone" dataKey="close" stroke={ASSET_COLORS.BTC} strokeWidth={2}
                          fill="url(#btcFill)" dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Forecast — plan ahead */}
            <Card className="border-primary/30">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {s.invested ? "When it plans to exit" : "When it plans to enter"}
              </div>
              <p className="mt-1 text-base font-medium">{data?.forecast?.headline}</p>
              <ul className="mt-3 space-y-2">
                {(data?.forecast?.conditions ?? []).map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-sm text-muted-foreground">{c.detail}</div>
                    </div>
                    <DistanceBadge pct={c.distance_pct} />
                  </li>
                ))}
              </ul>
              {data?.forecast?.eta && <p className="mt-3 text-sm text-muted-foreground">{data.forecast.eta}</p>}
            </Card>

            {/* Rules */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h3 className="mb-2 text-sm font-semibold text-emerald-400">Entry rules</h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  {(data?.rules?.entry ?? []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Card>
              <Card>
                <h3 className="mb-2 text-sm font-semibold text-rose-400">Exit rules</h3>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  {(data?.rules?.exit ?? []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Card>
            </div>
          </TabsContent>

          {/* ── HISTORY ───────────────────────────────────────────────── */}
          {/* The permanent record: completed round-trips first, then the 4h
              scalp tracker's own trades, then the raw day-by-day decision log
              that both are derived from (the same decisions sent to Telegram). */}
          <TabsContent value="history" className="space-y-6">

            {/* Bull Rotation — trade record */}
            <div>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Bull Rotation — trade record</h2>
                <span className="text-xs text-muted-foreground">
                  {trades.first_date ? `${trades.first_date} → ${trades.last_date} · ${trades.days_recorded} days recorded` : "—"}
                </span>
              </div>

              {tstats.scored > 0 && (
                <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Closed trades" value={tstats.n}
                        sub={`${tstats.wins}W / ${tstats.losses}L`} />
                  <Stat label="Win rate" value={`${tstats.win_rate}%`}
                        sub={`avg hold ${tstats.avg_hold_days}d`} />
                  <Stat label="Compounded"
                        value={<span className={pnlClass(tstats.compounded_pct)}>{fmtPct(tstats.compounded_pct, 2)}</span>}
                        sub="net of fees, closed trades" />
                  <Stat label="Best / worst"
                        value={<span className="text-base">{fmtPct(tstats.best, 1)} / {fmtPct(tstats.worst, 1)}</span>}
                        sub={`avg ${fmtPct(tstats.avg_pnl_pct, 2)}`} />
                </div>
              )}

              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Asset</th>
                      <th className="px-4 py-3">Entered</th>
                      <th className="px-4 py-3">Exited</th>
                      <th className="px-4 py-3 text-right">Days</th>
                      <th className="px-4 py-3 text-right">Entry</th>
                      <th className="px-4 py-3 text-right">Exit</th>
                      <th className="px-4 py-3 text-right">P&amp;L</th>
                      <th className="px-4 py-3">Closed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.open_trade && (
                      <tr className="border-b border-border/50 bg-primary/5">
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium"
                            style={{ color: ASSET_COLORS[trades.open_trade.asset] ?? undefined }}>
                          {trades.open_trade.asset}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">{trades.open_trade.entry_date}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">open</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{trades.open_trade.hold_days}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(trades.open_trade.entry_price)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(trades.open_trade.exit_price)}</td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${pnlClass(trades.open_trade.pnl_pct)}`}>
                          {fmtPct(trades.open_trade.pnl_pct, 2)}
                          {trades.open_trade.pnl_usd != null && (
                            <span className="ml-1 text-xs text-muted-foreground">({fmtUsd(trades.open_trade.pnl_usd)})</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">still open · unrealised</td>
                      </tr>
                    )}
                    {closedTrades.map((t, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium"
                            style={{ color: ASSET_COLORS[t.asset] ?? undefined }}>{t.asset}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">{t.entry_date}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">{t.exit_date}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{t.hold_days}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(t.entry_price)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(t.exit_price)}</td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${pnlClass(t.pnl_pct)}`}>
                          {fmtPct(t.pnl_pct, 2)}
                          {t.pnl_usd != null && (
                            <span className="ml-1 text-xs text-muted-foreground">({fmtUsd(t.pnl_usd)})</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {t.exit_action}
                          {t.exit_to && t.exit_to !== "CASH" && <> → {t.exit_to}</>}
                          {t.recovered && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                              recovered
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {closedTrades.length === 0 && !trades.open_trade && (
                  <p className="p-4 text-sm text-muted-foreground">No trades recorded yet.</p>
                )}
              </Card>
              <p className="mt-2 text-xs text-muted-foreground">
                Returns are priced from the daily closes the strategy acts on, net of the
                0.4% transition cost. Rows marked <em>recovered</em> were rebuilt from the
                strategy log after an earlier retention limit dropped them. Dollar figures
                appear only where the recorded portfolio value agrees with the price move.
              </p>
            </div>

            {/* Scalp tracker — trade record */}
            {scalp.available && (
              <div>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">4h scalp tracker — trade record</h2>
                  <span className="text-xs text-muted-foreground">
                    {scalp.first_date ? `${scalp.first_date} → ${scalp.last_date}` : "—"}
                  </span>
                </div>

                {sstats.scored > 0 && (
                  <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Closed trades" value={sstats.n} sub={`${sstats.wins}W / ${sstats.losses}L`} />
                    <Stat label="Win rate" value={`${sstats.win_rate}%`} sub="target 2R, stop 1R" />
                    <Stat label="Total R"
                          value={<span className={pnlClass(sstats.total_R)}>{fmtR(sstats.total_R)}</span>}
                          sub="sum of risk multiples" />
                    <Stat label="Expectancy"
                          value={<span className={pnlClass(sstats.expectancy_R)}>{fmtR(sstats.expectancy_R)}</span>}
                          sub="per trade" />
                  </div>
                )}

                {scalp.open_positions.length > 0 && (
                  <Card className="mb-3">
                    <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Open now</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {scalp.open_positions.map((p, i) => (
                        <div key={i} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{p.symbol}</span>
                            <span className={p.dir === 1 ? "text-emerald-400" : "text-rose-400"}>{p.bias}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            entry {fmtPrice(p.entry)} · stop {fmtPrice(p.stop)} · tp {fmtPrice(p.tp)}
                          </div>
                          <div className={`text-xs ${pnlClass(p.unrealized_R)}`}>
                            {fmtR(p.unrealized_R)} unrealised · opened {String(p.opened_at ?? "").slice(0, 10)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card className="overflow-x-auto p-0">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3">Symbol</th>
                        <th className="px-4 py-3">Side</th>
                        <th className="px-4 py-3">Opened</th>
                        <th className="px-4 py-3">Closed</th>
                        <th className="px-4 py-3 text-right">Entry</th>
                        <th className="px-4 py-3 text-right">Exit</th>
                        <th className="px-4 py-3 text-right">R</th>
                        <th className="px-4 py-3">Closed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleScalp.map((t, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium">{t.symbol}</td>
                          <td className={`whitespace-nowrap px-4 py-2.5 ${t.dir === 1 ? "text-emerald-400" : "text-rose-400"}`}>{t.bias}</td>
                          <td className="whitespace-nowrap px-4 py-2.5">{String(t.opened_at ?? "").slice(0, 10)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5">{String(t.closed_at ?? "").slice(0, 10)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(t.entry)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtPrice(t.exit)}</td>
                          <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${pnlClass(t.R)}`}>{fmtR(t.R)}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{t.reason} · {t.bars_held} bars</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                {scalp.closed_trades.length > SCALP_PREVIEW && (
                  <button onClick={() => setAllScalp((v) => !v)}
                          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                    {allScalp ? "Show fewer" : `Show all ${scalp.closed_trades.length} scalp trades`}
                  </button>
                )}
              </div>
            )}

            {/* Daily decision log */}
            <div>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Daily decision log</h2>
                <span className="text-xs text-muted-foreground">
                  {history.length} day(s) — every decision, as sent to Telegram
                </span>
              </div>
              <Card className="overflow-x-auto p-0">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Position</th>
                      <th className="px-4 py-3 text-right">BTC price</th>
                      <th className="px-4 py-3 text-right">Portfolio</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((h, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="whitespace-nowrap px-4 py-2.5">{h.date}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-medium">{h.action}</td>
                        <td className="whitespace-nowrap px-4 py-2.5" style={{ color: ASSET_COLORS[h.position] ?? ASSET_COLORS.CASH }}>{h.position}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtUsd(h.btc_price)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">{fmtUsd(h.portfolio_value)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{h.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {history.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">No history yet.</p>
                )}
              </Card>
              {history.length > HISTORY_PREVIEW && (
                <button onClick={() => setAllHistory((v) => !v)}
                        className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {allHistory ? "Show fewer" : `Show all ${history.length} days`}
                </button>
              )}
            </div>
          </TabsContent>

          {/* ── LEARNING ──────────────────────────────────────────────── */}
          <TabsContent value="learning" className="space-y-6">
            <Card>
              <h3 className="mb-2 text-sm font-semibold">How Bull Rotation works</h3>
              <p className="text-sm text-muted-foreground">{data?.learning?.strategy_overview}</p>
              {Array.isArray(data?.learning?.tfr_components) && (
                <div className="mt-4">
                  <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">TFR rotation score — 7 components</div>
                  <div className="flex flex-wrap gap-2">
                    {data!.learning.tfr_components.map((c: string, i: number) => (
                      <span key={i} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold">Live parameters</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {Object.entries(data?.params ?? {}).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between border-b border-border/40 py-1">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Paper (shadow) strategies */}
            {data?.learning?.paper_trading?.candidates && (
              <Card>
                <h3 className="mb-1 text-sm font-semibold">Paper (shadow) strategies</h3>
                <p className="mb-3 text-sm text-muted-foreground">{data.learning.paper_trading.note}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3">Strategy</th><th className="py-2 pr-3">Position</th>
                        <th className="py-2 pr-3 text-right">Paper value</th><th className="py-2 pr-3 text-right">Return</th>
                        <th className="py-2 pr-3 text-right">vs live</th><th className="py-2 text-right">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.learning.paper_trading.candidates.map((c: any, i: number) => (
                        <tr key={i} className="border-b border-border/40 last:border-0">
                          <td className="py-2 pr-3"><span className="font-medium">{c.name}</span><div className="text-xs text-muted-foreground">{c.description}</div></td>
                          <td className="py-2 pr-3" style={{ color: ASSET_COLORS[c.position] ?? ASSET_COLORS.CASH }}>{c.position}</td>
                          <td className="py-2 pr-3 text-right">{fmtUsd(c.paper_value)}</td>
                          <td className="py-2 pr-3 text-right">{fmtPct(c.return_pct)}</td>
                          <td className={`py-2 pr-3 text-right ${c.name === "live-v4" ? "text-muted-foreground" : (c.excess_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {c.name === "live-v4" ? "—" : fmtPct(c.excess_return_pct)}
                          </td>
                          <td className="py-2 text-right text-muted-foreground">{c.days_running}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Strategy health / decay flag */}
            {data?.learning?.decay && (() => {
              const d = data.learning.decay;
              const toneMap: Record<string, { card: string; dot: string }> = {
                green: { card: "border-emerald-500/40 bg-emerald-500/5", dot: "bg-emerald-400" },
                amber: { card: "border-amber-500/40 bg-amber-500/5", dot: "bg-amber-400" },
                red: { card: "border-rose-500/40 bg-rose-500/5", dot: "bg-rose-400" },
              };
              const t = toneMap[d.flag] ?? toneMap.red;
              return (
                <Card className={t.card}>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${t.dot}`} />
                    <h3 className="text-sm font-semibold">Strategy health — decay flag: {String(d.flag).toUpperCase()}</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{d.message}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                    <div><div className="text-xs text-muted-foreground">Live (v4) return</div><div className="font-medium">{fmtPct(d.live_full?.return_pct, 0)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Live Sharpe</div><div className="font-medium">{d.live_full?.sharpe}</div></div>
                    <div><div className="text-xs text-muted-foreground">Live max DD</div><div className="font-medium">{fmtPct(d.live_full?.max_drawdown_pct, 0)}</div></div>
                    <div><div className="text-xs text-muted-foreground">Recent window Sharpe</div><div className="font-medium">{d.recent_window_sharpe}</div></div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Backtest basis over {d.data_window?.start} → {d.data_window?.end}. Per-window OOS Sharpe: {(d.window_sharpe ?? []).join(", ")}.
                  </p>
                </Card>
              );
            })()}

            {/* Weekly self-reflection */}
            <Card>
              <h3 className="mb-2 text-sm font-semibold">Weekly self-reflection</h3>
              {data?.learning?.weekly_reflection ? (() => {
                const w = data.learning.weekly_reflection;
                const vColor: Record<string, string> = { PROMOTE_PAPER: "text-emerald-400", INCONCLUSIVE: "text-amber-400", REJECT: "text-rose-400" };
                return (
                  <div className="space-y-4">
                    <div className="text-xs text-muted-foreground">Week of {w.week_of}</div>
                    <p className="text-sm">{w.reflection}</p>
                    {Array.isArray(w.candidates_tested) && w.candidates_tested.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="py-2 pr-3">Candidate</th><th className="py-2 pr-3">Verdict</th>
                              <th className="py-2 pr-3 text-right">Return</th><th className="py-2 pr-3 text-right">vs live</th>
                              <th className="py-2 pr-3 text-right">Win%</th><th className="py-2 pr-3 text-right">PSR</th><th className="py-2 text-right">DSR</th>
                            </tr>
                          </thead>
                          <tbody>
                            {w.candidates_tested.map((c: any, i: number) => (
                              <tr key={i} className="border-b border-border/40 last:border-0">
                                <td className="py-2 pr-3 font-medium">{c.name}</td>
                                <td className={`py-2 pr-3 font-medium ${vColor[c.verdict] ?? ""}`}>{c.verdict}</td>
                                <td className="py-2 pr-3 text-right">{fmtPct(c.candidate_return_pct, 0)}</td>
                                <td className={`py-2 pr-3 text-right ${(c.candidate_return_pct ?? 0) - (c.live_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                  {c.candidate_return_pct == null || c.live_return_pct == null ? "—" : fmtPct(c.candidate_return_pct - c.live_return_pct, 0)}
                                </td>
                                <td className="py-2 pr-3 text-right">{Math.round((c.win_fraction ?? 0) * 100)}%</td>
                                <td className="py-2 pr-3 text-right">{c.psr}</td>
                                <td className="py-2 text-right">{c.dsr}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {w.recommendation && (
                      <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                        <span className="font-semibold">Recommendation: </span>{w.recommendation}
                      </div>
                    )}
                    {Array.isArray(w.backlog_ideas) && (
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Idea backlog (need engine features)</div>
                        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                          {w.backlog_ideas.map((b: string, i: number) => <li key={i}>{b}</li>)}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Promotion is advisory — "promote" means shadow-trade and validate forward, never auto-deploy to live capital.
                    </p>
                  </div>
                );
              })() : (
                <p className="text-sm text-muted-foreground">
                  The adaptive research loop will post a weekly scorecard here — what worked,
                  what didn't, the decay flag on the live edge, and any candidate upgrades
                  being back-tested against the current strategy before promotion.
                </p>
              )}
            </Card>
          </TabsContent>
        </Tabs>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Display only. Figures update after each daily close (~00:15 UTC). Historical /
          backtest figures are labelled as such and are not a guarantee of future results.
        </p>
      </div>
    </div>
  );
}
