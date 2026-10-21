/**
 * Scarton SMSF: the owner's self-managed super fund strategy.
 * Main rules = version B: equal fifths of VT, TLT, GLDM, REET and IBIT at
 * Interactive Brokers, each timed monthly by its 12-month average, with the
 * whole portfolio reset to equal fifths at every buy-back. The other three
 * versions run beside it as live forward tests from a fixed start date.
 * All numbers come from /api/smsf, emitted by scripts/smsf_trend.py; nothing
 * is computed here beyond chart geometry and labels.
 */
import { useEffect, useRef, useState } from "react";
import { formatPct, formatPrice, formatUsd, longDate, monthYear, shortDate, toneOf } from "@/lib/cockpit";

interface Switch { date: string; ticker: string; action: "buy" | "sell"; close: number; average: number }
interface Holding {
  ticker: string; name: string; role: string; exposure: string;
  close: number; average: number; distance_pct: number; above: boolean;
  rule_invested: boolean; last_switch: Switch | null; fund_start: string; model_weight_pct: number;
}
interface Stats { final_value: number; total_return_pct: number; cagr_pct: number; max_drawdown_pct: number; volatility_pct: number }
interface Sleeve { ticker: string; rule: Stats; buy_hold: Stats; time_invested_pct: number; trades: number }
type VersionKey = "rule" | "rule_rebalanced" | "buy_hold_yearly" | "buy_hold";
type Curve = ({ date: string } & Record<VersionKey, number>)[];
interface StartWindow extends Record<VersionKey, Stats> { start_date: string }
interface Backtest extends Record<VersionKey, Stats> {
  start_date: string; end_date: string; start_value: number; trade_cost_pct: number; cash_proxy: string;
  proxies: { ticker: string; proxy: string; until: string }[];
  rule: Stats & { trades: number };
  rule_rebalanced: Stats & { trades: number; rebalances: number };
  sleeves: Sleeve[];
  windows: StartWindow[];
  annual: ({ year: number } & Record<VersionKey, number>)[];
  curve: Curve;
  curve_start_date?: string;
  recent_trades: Switch[];
}
interface ForwardEvent { date: string; kind: "buy" | "sell" | "reset"; ticker?: string; close?: number; average?: number }
interface Forward {
  inception_date: string; start_value: number; trading_days: number;
  versions: Record<VersionKey, { value: number; return_pct: number; max_drawdown_pct: number }>;
  curve: Curve;
  main_positions: { ticker: string; invested: boolean; value: number; weight_pct: number }[];
  main_cash_pct: number;
  main_events: ForwardEvent[];
}
interface SmsfPayload {
  available: boolean; generated_at?: string; as_of_date?: string;
  method?: { average_days: number; average_basis: string; sell_rule: string; buy_rule: string; rebalance_rule: string };
  next_checks?: { sell_check: string; buy_check: string };
  holdings?: Holding[]; backtest?: Backtest; forward?: Forward;
}

const POLL_MS = 15 * 60 * 1000;
const MONO = "IBM Plex Mono, ui-monospace, monospace";
const right = { textAlign: "right" as const };

/** Fixed order and colour per version; colour follows the version everywhere. */
const VERSIONS: { key: VersionKey; label: string; short: string; color: string; dash?: string }[] = [
  { key: "rule_rebalanced", label: "B · Main rules: reset to equal fifths at each buy-back", short: "B (main)", color: "var(--series-1)" },
  { key: "rule", label: "A · Rule, buy back only with the sold fund's cash", short: "A", color: "var(--series-2)" },
  { key: "buy_hold_yearly", label: "Hold, reset to equal fifths each January", short: "Hold yearly", color: "var(--series-3)", dash: "6 4" },
  { key: "buy_hold", label: "Hold, never rebalanced", short: "Hold", color: "var(--series-4)", dash: "2 4" },
];

/** Market data older than four calendar days (a long weekend) is stale. */
function stale(asOf: string | undefined): boolean {
  if (!asOf) return true;
  return Date.now() - Date.parse(`${asOf}T00:00:00Z`) > 4 * 86_400_000;
}

function action(h: Holding, checks: SmsfPayload["next_checks"]): { chip: string; label: string } {
  if (h.rule_invested && h.above) return { chip: "good", label: "Hold" };
  if (h.rule_invested) return { chip: "warn", label: `Sell if still below on ${checks ? longDate(checks.sell_check) : "month end"}` };
  if (h.above) return { chip: "hold", label: `Buy back and reset to fifths if still above on ${checks ? longDate(checks.buy_check) : "the 1st"}` };
  return { chip: "mute", label: "Stay in cash" };
}

export function SmsfView() {
  const [data, setData] = useState<SmsfPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/smsf", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SmsfPayload;
        if (!cancelled) { setData(json); setError(false); }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const header = (
    <div className="topbar">
      <div>
        <h1>Scarton SMSF</h1>
        <p>Equal fifths, timed by 12-month averages, reset at each buy-back · held at Interactive Brokers
          {data?.as_of_date && <> · prices to the {longDate(data.as_of_date)} US close</>}</p>
      </div>
      {data?.available && (
        <a className="theme-btn" href="/api/smsf/report.pdf" download style={{ textDecoration: "none" }}>
          Download report (PDF)
        </a>
      )}
    </div>
  );

  if (!data || !data.available || !data.holdings || !data.backtest || !data.forward) {
    return (
      <section className="view on" aria-label="Scarton SMSF">
        {header}
        <div className="state">
          {!data && !error ? <><b>Loading the SMSF signals…</b>Reading the latest prices.</> : <>
            <b>SMSF signals are unavailable</b>
            {error ? "The dashboard couldn't reach the server. It retries every 15 minutes." : "The daily price update hasn't published yet. It runs after each US market close."}
          </>}
        </div>
      </section>
    );
  }

  const { holdings, backtest: bt, forward: fw, next_checks: checks, method } = data;
  const investedPct = 100 - fw.main_cash_pct;

  return (
    <section className="view on" aria-label="Scarton SMSF">
      {header}
      {stale(data.as_of_date) && (
        <div className="callout warn"><span className="stale">Prices may be out of date.</span> The latest close is {longDate(data.as_of_date!)}.</div>
      )}

      <div className="panel">
        <div className="sechead" style={{ marginBottom: 14 }}>
          <div>
            <p className="eyebrow">Main portfolio · model holdings today</p>
            <h2>{investedPct.toFixed(0)}% invested, {fw.main_cash_pct.toFixed(0)}% in cash</h2>
          </div>
          {checks && (
            <div className="smsf-key">
              <span>Sell check <b className="mono">{longDate(checks.sell_check)}</b></span>
              <span>Buy-back check <b className="mono">{longDate(checks.buy_check)}</b></span>
            </div>
          )}
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr>
              <th>Fund</th><th>Model holding</th><th style={right}>Close</th><th style={right}>12-month avg</th>
              <th style={right}>vs avg</th><th>Next step</th>
            </tr></thead>
            <tbody>
              {holdings.map(h => {
                const a = action(h, checks);
                return (
                  <tr key={h.ticker}>
                    <td><div><b className="mono">{h.ticker}</b> <span className="muted">· {h.role}</span></div><div className="muted" style={{ fontSize: 12 }}>{h.name}</div></td>
                    <td>
                      <div><span className="mono">{h.model_weight_pct.toFixed(1)}%</span> {h.rule_invested ? `in ${h.ticker}` : "as cash"}</div>
                      {h.last_switch && <div className="muted" style={{ fontSize: 12 }}>{h.rule_invested ? "bought back" : "sold"} {longDate(h.last_switch.date)}</div>}
                    </td>
                    <td className="mono" style={right}>{formatPrice(h.close)}</td>
                    <td className="mono" style={right}>{formatPrice(h.average)}</td>
                    <td className={`mono ${toneOf(h.distance_pct)}`} style={right}>{formatPct(h.distance_pct, 1)}</td>
                    <td><span className={`chip ${a.chip}`}>{a.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Model holdings are the main portfolio's weights in the live forward test, not your actual Interactive Brokers account.
          Starting today, buy only the funds shown as invested and hold the rest as cash.
          Check dates are weekdays; if one falls on a US market holiday, use the nearest trading day.
        </p>
      </div>

      {method && (
        <div className="panel">
          <div className="sechead" style={{ marginBottom: 14 }}><div><p className="eyebrow">Main portfolio rules</p><h2>Two checks a month, and a reset to equal fifths on every buy-back</h2></div></div>
          <div className="smsf-rules">
            <div><b>Last day of the month · sell check</b>{method.sell_rule}</div>
            <div><b>First day of the month · buy-back check</b>{method.buy_rule}</div>
            <div><b>Reset on buy-back</b>{method.rebalance_rule}</div>
            <div><b>12-month average</b>The mean of the last {method.average_days} daily closes. {method.average_basis}.</div>
          </div>
        </div>
      )}

      <ForwardPanel fw={fw} />
      <BacktestPanel bt={bt} />
    </section>
  );
}

// ── Forward test ─────────────────────────────────────────────────────────────
function ForwardPanel({ fw }: { fw: Forward }) {
  const started = fw.trading_days > 0;
  return (
    <div className="panel">
      <div className="sechead" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">Live forward test · since the {longDate(fw.inception_date)} close</p>
          <h2>{started
            ? `${fw.trading_days} trading day${fw.trading_days === 1 ? "" : "s"} of real prices, ${formatUsd(fw.start_value)} in each version`
            : `Started at the ${longDate(fw.inception_date)} close with ${formatUsd(fw.start_value)} in each version`}</h2>
        </div>
      </div>
      <div className="tablewrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Version</th><th style={right}>Value</th><th style={right}>Return</th><th style={right}>Worst fall</th></tr></thead>
          <tbody>
            {VERSIONS.map(v => {
              const st = fw.versions[v.key];
              return (
                <tr key={v.key}>
                  <td><span className="smsf-key"><span><Swatch color={v.color} dash={v.dash} />{v.label}</span></span></td>
                  <td className="mono" style={right}>{formatUsd(st.value)}</td>
                  <td className={`mono ${toneOf(st.return_pct)}`} style={right}>{formatPct(st.return_pct, 2)}</td>
                  <td className="mono" style={right}>{st.max_drawdown_pct < 0 ? <span className="down">{st.max_drawdown_pct.toFixed(1)}%</span> : <span className="muted">none yet</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {fw.curve.length >= 2
        ? <ValueChart curve={fw.curve} daily label="Forward-test value for four versions since inception, log scale" />
        : <p className="note">The chart appears after the next US close. Every version is replayed on real closes from the start date, which never moves.</p>}
      {fw.main_events.length > 0 && <>
        <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Main portfolio trades since the start</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Action</th><th>Fund</th><th style={right}>Close</th><th style={right}>12-month avg</th></tr></thead>
            <tbody>
              {fw.main_events.map((e, i) => (
                <tr key={`${e.date}-${e.kind}-${e.ticker ?? i}`}>
                  <td className="mono">{longDate(e.date)}</td>
                  <td><span className={`chip ${e.kind === "buy" ? "good" : e.kind === "sell" ? "bad" : "hold"}`}>{e.kind === "buy" ? "Buy back" : e.kind === "sell" ? "Sell to cash" : "Reset to fifths"}</span></td>
                  <td className="mono">{e.ticker ? <b>{e.ticker}</b> : <span className="muted">all</span>}</td>
                  <td className="mono" style={right}>{e.close != null ? formatPrice(e.close) : ""}</td>
                  <td className="mono" style={right}>{e.average != null ? formatPrice(e.average) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      <p className="note" style={{ marginTop: 12 }}>
        Paper only: the same rules, costs and cash interest as the backtest, applied to closes after the start date. A few weeks of results say little; judge it over years.
      </p>
    </div>
  );
}

// ── Backtest ─────────────────────────────────────────────────────────────────

function Swatch({ color, dash }: { color: string; dash?: string }) {
  return <i style={{ borderColor: color, borderTopStyle: dash ? (dash.startsWith("2") ? "dotted" : "dashed") : "solid" }} />;
}

const pct1 = (v: number) => formatPct(v, 1);
const dd1 = (v: number) => `${v.toFixed(1)}%`;

function BacktestPanel({ bt }: { bt: Backtest }) {
  const lastYear = bt.annual.length ? bt.annual[bt.annual.length - 1].year : null;
  const firstYear = bt.annual.length ? bt.annual[0].year : null;
  const activity = (k: VersionKey) =>
    k === "rule" ? `${bt.rule.trades} switches`
      : k === "rule_rebalanced" ? `${bt.rule_rebalanced.trades} switches · ${bt.rule_rebalanced.rebalances} resets`
      : k === "buy_hold_yearly" ? `${bt.annual.length - 1} resets` : "none";
  return (
    <div className="panel">
      <div className="sechead" style={{ marginBottom: 14 }}>
        <div>
          <p className="eyebrow">Backtest · {longDate(bt.start_date)} to {longDate(bt.end_date)}</p>
          <h2>The main rules against three alternatives, from {formatUsd(bt.start_value)} in equal fifths</h2>
        </div>
      </div>

      <div className="tablewrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr>
            <th>Version</th><th style={right}>Ends at</th><th style={right}>Growth a year</th>
            <th style={right}>Worst fall</th><th style={right}>Volatility</th><th>Trading</th>
          </tr></thead>
          <tbody>
            {VERSIONS.map(v => {
              const st = bt[v.key];
              return (
                <tr key={v.key}>
                  <td><span className="smsf-key"><span><Swatch color={v.color} dash={v.dash} />{v.label}</span></span></td>
                  <td className="mono" style={right}>{formatUsd(st.final_value)}</td>
                  <td className={`mono ${toneOf(st.cagr_pct)}`} style={right}>{pct1(st.cagr_pct)}</td>
                  <td className="mono down" style={right}>{dd1(st.max_drawdown_pct)}</td>
                  <td className="mono" style={right}>{st.volatility_pct.toFixed(1)}%</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{activity(v.key)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, margin: "4px 0 4px" }}>From {longDate(bt.curve_start_date ?? bt.start_date)} to {longDate(bt.end_date)}</h3>
      {bt.curve_start_date && bt.curve_start_date !== bt.start_date && (
        <p className="note" style={{ marginBottom: 8 }}>The chart restarts all four versions at {formatUsd(bt.start_value)} in equal fifths on this date. The table above covers the full backtest.</p>
      )}
      <ValueChart curve={bt.curve} label={`Backtest portfolio value for four versions from ${longDate(bt.curve_start_date ?? bt.start_date)}, log scale`} />

      {bt.windows.length > 0 && <>
        <h3 style={{ fontSize: 14, margin: "18px 0 4px" }}>Does it depend on the start date?</h3>
        <p className="note" style={{ marginBottom: 8 }}>Each row restarts all four versions at equal fifths on that date. Growth a year · worst fall.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Start</th>{VERSIONS.map(v => <th key={v.key} style={right}>{v.short}</th>)}</tr></thead>
            <tbody>
              {[{ start_date: bt.start_date, ...Object.fromEntries(VERSIONS.map(v => [v.key, bt[v.key]])) } as StartWindow, ...bt.windows].map(w => (
                <tr key={w.start_date}>
                  <td className="mono">{longDate(w.start_date)}</td>
                  {VERSIONS.map(v => (
                    <td key={v.key} className="mono" style={right}>
                      <span className={toneOf(w[v.key].cagr_pct)}>{pct1(w[v.key].cagr_pct)}</span>
                      <span className="muted"> · {dd1(w[v.key].max_drawdown_pct)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Each fund on its own: the rule vs holding it</h3>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th>Fund</th><th style={right}>Growth a year<br /><span className="muted">rule · held</span></th>
            <th style={right}>Worst fall<br /><span className="muted">rule · held</span></th>
            <th style={right}>Time invested</th><th style={right}>Switches</th>
          </tr></thead>
          <tbody>
            {bt.sleeves.map(s => (
              <tr key={s.ticker}>
                <td className="mono"><b>{s.ticker}</b></td>
                <td className="mono" style={right}><span className={toneOf(s.rule.cagr_pct)}>{pct1(s.rule.cagr_pct)}</span> <span className="muted">· {pct1(s.buy_hold.cagr_pct)}</span></td>
                <td className="mono" style={right}><span className="down">{dd1(s.rule.max_drawdown_pct)}</span> <span className="muted">· {dd1(s.buy_hold.max_drawdown_pct)}</span></td>
                <td className="mono" style={right}>{s.time_invested_pct.toFixed(0)}%</td>
                <td className="mono" style={right}>{s.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Year by year</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Year</th>{VERSIONS.map(v => <th key={v.key} style={right}>{v.short}</th>)}</tr></thead>
          <tbody>
            {bt.annual.map(a => (
              <tr key={a.year}>
                <td className="mono">{a.year}{a.year === firstYear ? <span className="muted"> · from {shortDate(bt.start_date)}</span> : a.year === lastYear ? <span className="muted"> · to date</span> : null}</td>
                {VERSIONS.map(v => <td key={v.key} className={`mono ${toneOf(a[v.key])}`} style={right}>{pct1(a[v.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bt.recent_trades.length > 0 && <>
        <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Recent switches</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Fund</th><th>Action</th><th style={right}>Close</th><th style={right}>12-month avg</th></tr></thead>
            <tbody>
              {bt.recent_trades.map(t => (
                <tr key={`${t.date}-${t.ticker}`}>
                  <td className="mono">{longDate(t.date)}</td>
                  <td className="mono"><b>{t.ticker}</b></td>
                  <td><span className={`chip ${t.action === "buy" ? "good" : "bad"}`}>{t.action === "buy" ? "Buy back" : "Sell to cash"}</span></td>
                  <td className="mono" style={right}>{formatPrice(t.close)}</td>
                  <td className="mono" style={right}>{formatPrice(t.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      <p className="note" style={{ marginTop: 12 }}>
        Historical simulation, not a forecast. A and B make the same buys and sells; only the weights differ.
        {" "}Returns include dividends; every trade, including rebalancing, costs {bt.trade_cost_pct}% of the amount moved; cash earns {bt.cash_proxy}.
        {" "}Before a fund existed its history is borrowed: {bt.proxies.map(p => `${p.ticker} uses ${p.proxy} before ${longDate(p.until)}`).join("; ")}.
        {" "}Versions that never rebalance let bitcoin grow to dominate, so their totals mostly reflect bitcoin.
      </p>
    </div>
  );
}

function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}

/** About four evenly spaced round values for short, narrow ranges. */
function linearTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find(k => k * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

const kUsd = (v: number) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(1)}k` : `$${Math.round(v)}`);

function ValueChart({ curve, label, daily }: { curve: Curve; label: string; daily?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const n = curve.length;
  if (n < 2) return null;
  const W = 1000, H = 320, m = { l: 56, r: 104, t: 12, b: 28 };
  const all = curve.flatMap(p => VERSIONS.map(v => p[v.key]));
  const pad = daily ? 0.01 : 0.1;
  const lo = Math.min(...all) * (1 - pad), hi = Math.max(...all) * (1 + pad);
  const x = (i: number) => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (H - m.t - m.b);
  const path = (k: VersionKey) => curve.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  const ticks = daily ? linearTicks(lo, hi) : logTicks(lo, hi);
  const nx = Math.min(6, n);
  const xl = Array.from(new Set(Array.from({ length: nx }, (_, j) => Math.round((j * (n - 1)) / Math.max(1, nx - 1)))));
  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (n - 1)))));
  };
  // End labels, nudged apart so close finishes don't overlap.
  const last = curve[n - 1];
  const ends = VERSIONS.map(v => ({ ...v, y: y(last[v.key]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 15);
  const hp = hover != null ? curve[hover] : null;
  const top = hp ? Math.min(...VERSIONS.map(v => y(hp[v.key]))) : 0;
  return (
    <>
      <div className="smsf-key" style={{ marginBottom: 6 }}>
        {VERSIONS.map(v => <span key={v.key}><Swatch color={v.color} dash={v.dash} />{v.short}</span>)}
        <span className="muted">Log scale: equal steps are equal percentage moves</span>
      </div>
      <div className="pf-chart" style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}
          onMouseMove={e => onMove(e.clientX)} onMouseLeave={() => setHover(null)}
          onTouchMove={e => onMove(e.touches[0].clientX)} onTouchEnd={() => setHover(null)}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)" fontFamily={MONO}>{kUsd(t)}</text>
            </g>
          ))}
          {xl.map(i => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={12} fill="var(--muted)" fontFamily={MONO}>
              {daily ? shortDate(curve[i].date) : monthYear(curve[i].date)}
            </text>
          ))}
          {[...VERSIONS].reverse().map(v => (
            <path key={v.key} d={path(v.key)} fill="none" stroke={v.color} strokeWidth={2} strokeDasharray={v.dash} strokeLinejoin="round" />
          ))}
          {ends.map(e => (
            <text key={e.key} x={x(n - 1) + 8} y={e.y + 4} fontSize={12} fill="var(--ink-2)" fontFamily={MONO}>{e.short}</text>
          ))}
          {hp && hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="2 3" />
              {VERSIONS.map(v => (
                <circle key={v.key} cx={x(hover)} cy={y(hp[v.key])} r={4.5} fill={v.color} stroke="var(--panel)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hp && hover != null && (
          <div className="pf-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(top / H) * 100}%` }}>
            <span className="d">{longDate(hp.date)}</span>
            {VERSIONS.map(v => <span key={v.key} className="v">{v.short} {formatUsd(hp[v.key])}</span>)}
          </div>
        )}
      </div>
    </>
  );
}
